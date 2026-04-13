// =============================================
// LÓGICA DEL BOT - Carrito del Paseo
// =============================================

require("dotenv").config();
const Groq = require("groq-sdk");
const { LOCAL_INFO, getMenuAsText } = require("./menu");
const { sendMessage } = require("./whatsapp");
const supabase = require("./db");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────
// SESIONES
// Estados posibles: "bot" | "handoff"
// ─────────────────────────────────────────────
const sessions = new Map();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;   // 15 min sin actividad → sesión nueva
const HANDOFF_TIMEOUT_MS = 30 * 60 * 1000;   // 30 min → bot se reactiva solo
const MAX_MESSAGES = 40;                       // límite antes de derivar por loop

function getSession(phone) {
    const session = sessions.get(phone);
    if (!session) return null;

    const now = Date.now();

    // Si está en handoff y ya pasó 1 hora → reactivar bot automáticamente
    if (session.status === "handoff" && now - session.handoffAt > HANDOFF_TIMEOUT_MS) {
        console.log(`⏰ Reactivando bot para ${phone} (1 hora transcurrida)`);
        session.status = "bot";
        session.messages = [];
        session.handoffAt = null;
        session.handoffNotified = false;
    }

    // Si la sesión expiró por inactividad (y no está en handoff) → limpiar
    if (session.status === "bot" && now - session.lastActivity > SESSION_TIMEOUT_MS) {
        sessions.delete(phone);
        return null;
    }

    session.lastActivity = now;
    return session;
}

function createSession(phone) {
    const session = {
        status: "bot",         // "bot" | "handoff"
        messages: [],
        lastActivity: Date.now(),
        handoffAt: null,
        handoffNotified: false,
    };
    sessions.set(phone, session);
    return session;
}

// Fuerza handoff: apaga el bot para este cliente
function setHandoff(phone) {
    const session = sessions.get(phone);
    if (session) {
        session.status = "handoff";
        session.handoffAt = Date.now();
        session.messages = []; // limpiar historial
    }
}

// ─────────────────────────────────────────────
// HORARIO
// ─────────────────────────────────────────────
function isOpen() {
    const now = new Date();
    const hour = parseInt(
        now.toLocaleString("es-UY", {
            hour: "numeric",
            hour12: false,
            timeZone: "America/Montevideo",
        })
    );
    return hour >= 9 || hour < 2; 
}

// ─────────────────────────────────────────────
// NUMERACIÓN DE PEDIDOS
// ─────────────────────────────────────────────
let orderCounter = 0;
let lastOrderDate = new Date().toDateString();

function getOrderNumber() {
    const today = new Date().toDateString();
    if (today !== lastOrderDate) {
        orderCounter = 0;
        lastOrderDate = today;
    }
    orderCounter++;
    return `#${String(orderCounter).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Sos el asistente de pedidos de *Carrito del Paseo*, Paysandú, Uruguay.
Tu único rol es tomar pedidos y responder preguntas básicas del local.

---
📍 DATOS DEL LOCAL:
- Dirección: ${LOCAL_INFO.direccion}
- Teléfono: ${LOCAL_INFO.telefono}
- Horarios: ${LOCAL_INFO.horarios}
- Delivery: ${LOCAL_INFO.delivery.zona}. Costo base: $${LOCAL_INFO.delivery.costo} (puede variar según distancia)
- Pago delivery: solo efectivo
- Retiro en local: sin costo adicional
---

📋 MENÚ (precios en pesos uruguayos):
${getMenuAsText()}

EXTRAS disponibles: +panceta, +huevo frito, +queso extra — cada uno $50 adicional.

VERDURAS DISPONIBLES (solo estas, no hay otras):
lechuga, tomate, cebolla, morrón, pepino.
Si el cliente pide una verdura que NO está en esa lista, decile que no tenemos esa verdura y preguntale cuáles de las disponibles quiere.

---

🔴 REGLAS — LEELAS TODAS ANTES DE RESPONDER:

REGLA 0 — LO MÁS IMPORTANTE:
Si el cliente pregunta algo que NO podés responder con los datos que tenés (demoras, precios de envío a direcciones específicas, ofertas, stock, si llegan a cierto barrio, etc.) NO inventes ni estimes. Tu respuesta completa debe ser EXACTAMENTE estas dos líneas, sin agregar nada más:
IMPORTANTE: "clientePhone" debe ser el número real del cliente, siempre entre comillas, 
nunca escribas la palabra PHONE ni ningún placeholder.
IMPORTANTE: No escribas razonamiento interno, advertencias ni instrucciones en el mensaje 
al cliente. Solo la frase indicada, nada más.
Línea 1: Ahora te contacta alguien del local para responder eso. 👋
Línea 2: DERIVAR_HUMANO:{"motivo":"consulta_sin_respuesta","clientePhone":"[número real]","resumen":"[mensaje del cliente]"}


REGLA 1 — TONO:
Breve y directo. Sin frases de relleno ("¡Qué buena elección!", "Con gusto", "Perfecto", "Claro que sí"). Solo lo necesario.

REGLA 2 — TOMAR EL PEDIDO:
- Anotá los productos.
- Para productos con "+verduras a elección": preguntá "¿Con qué verduras lo querés? (lechuga, tomate, cebolla, morrón, pepino)"
- Si el cliente menciona una verdura que no existe en nuestra lista, corregilo: "No tenemos [esa verdura]. Las disponibles son: lechuga, tomate, cebolla, morrón, pepino."
- Si el cliente pide extras (+panceta, +huevo, +queso): confirmá cuál y sumá $50 por cada uno.
- Si el cliente pide sacar un ingrediente (ej: "sin cebolla", "sin tomate"): anotalo como detalle del producto. No preguntes sobre verduras si el cliente ya dijo que no quiere.
- Preguntá UNA SOLA VEZ si quiere agregar algo más al pedido.

REGLA 3 — RETIRO O DELIVERY:
Cuando el pedido esté completo, preguntá:
"¿Es para retirar o envío a domicilio?
1️⃣ Retirar en el local
2️⃣ Envío a domicilio"

REGLA 4 — DATOS NECESARIOS:
- RETIRAR: preguntá solo "¿A qué nombre va el pedido?"
- DELIVERY: pedí los 3 datos juntos:
  "Necesito estos datos:
  • Nombre
  • Dirección
  • Teléfono de contacto"
  No avances hasta tener los 3. Si falta alguno, pedí solo el que falta.

REGLA 5 — RESUMEN:
Cuando tenés TODOS los datos mostrá exactamente este formato:

📋 *SOLICITUD DE PEDIDO*

[nombre del producto][detalle si aplica: "sin cebolla", "con lechuga y tomate", "+panceta"] x[cant] — $[precio total con extras]

Subtotal: $XXX
[si delivery] Envío: $50 aprox
*TOTAL ESTIMADO: $XXX*

[si retiro] 🏪 Retiro en local — A nombre de: [nombre]
[si delivery] 🚚 Envío a: [dirección] — Contacto: [nombre] / [teléfono]
💵 Pago: Efectivo

¿Los datos son correctos?
✅ Respondé *SÍ* para enviar la solicitud al local
❌ Respondé *NO* para corregir algo

REGLA 6 — CONFIRMACIÓN DEL CLIENTE (dice "sí", "si", "confirmar", "dale", "ok", "correcto", "está bien"):

Respondé EXACTAMENTE en DOS mensajes separados:

MENSAJE 1 (visible para el cliente):
"✅ Solicitud enviada. El personal del local te confirma el pedido en breve. 🙌"

MENSAJE 2 (solo JSON, sin texto antes ni después):
{
  "items": [
    {
      "nombre": "...",
      "cantidad": N,
      "precio": N,
      "detalle": "..."
    }
  ],
  "subtotal": N,
  "total": N,
  "tipo": "retiro" o "delivery",
  "direccion": "...",
  "nombre": "...",
  "telefono": "...",
  "clientePhone": "NUMERO_REAL"
}

REGLAS DEL JSON:
- Debe ser JSON válido
- No agregar texto antes ni después
- No usar etiquetas como SOLICITUD_PEDIDO
- clientePhone debe ser el número real del cliente
- Si un campo no aplica (ej: dirección en retiro), usar null

REGLA 7 — EL CLIENTE DICE NO o quiere corregir:
Preguntá qué quiere cambiar y ajustá.

REGLA 8 — DERIVAR A PERSONA REAL:
Derivar SIEMPRE cuando el cliente:
- Pide hablar con una persona o dice que no lo estás entendiendo
- Pregunta cuánto demora / dónde está su pedido
- Hace una queja o reclamo
- Pregunta algo que no podés responder con los datos que tenés

IMPORTANTE: "clientePhone" debe ser el número real del cliente, siempre entre comillas, 
nunca escribas la palabra PHONE ni ningún placeholder.
IMPORTANTE: No escribas razonamiento interno, advertencias ni instrucciones en el mensaje 
al cliente. Solo la frase indicada, nada más.

Tu respuesta completa debe ser EXACTAMENTE estas dos líneas, sin agregar nada más:
Línea 1: Ahora te contacta alguien del local. 👋
Línea 2: DERIVAR_HUMANO:{"motivo":"[motivo]","clientePhone":"[número real]"}



REGLA 9 — NUNCA:
- Inventes tiempos de demora, precios de envío específicos, stock, ni ningún dato que no tenés.
- Inventes verduras o ingredientes que no están en la lista.
- Uses frases de relleno.
- Confirmes el pedido como aceptado. Solo enviás la SOLICITUD, el personal decide.
- Escribas razonamiento interno o texto del sistema en el mensaje al cliente.
- Empieces tu respuesta con frases como "No inventes", "Según mis instrucciones", 
  "Como asistente", o cualquier texto que no sea la respuesta directa al cliente.
- Escribas las señales técnicas SOLICITUD_PEDIDO o DERIVAR_HUMANO en el cuerpo visible del mensaje.

REGLA 10 — FORMATO DE RESPUESTA FINAL:
Cuando envíes el JSON del pedido, debe ser el ÚNICO contenido del mensaje.
No incluyas emojis, texto, explicaciones ni etiquetas.`;

// ─────────────────────────────────────────────
// PROCESO PRINCIPAL
// ─────────────────────────────────────────────
async function processMessage(phone, messageText) {
    let session = getSession(phone);
    const isNewSession = !session;
    if (!session) {
        session = createSession(phone);
    }

    // Si está en handoff → ignorar silenciosamente
    if (session.status === "handoff") {
        console.log(`🤝 Handoff activo para ${phone}, ignorando mensaje`);
        return null;
    }

    // Fuera de horario
    if (!isOpen()) {
        return "🕐 En este momento estamos cerrados.\n\nNuestro horario es de *19:00 a 02:00 hs*. ¡Volvemos esta noche! 🍔";
    }

    // Demasiados mensajes en la sesión → derivar
    if (session.messages.length >= MAX_MESSAGES) {
        await notifyHandoff(phone, "loop_mensajes", "La sesión superó los 40 mensajes.");
        setHandoff(phone);
        return "Parece que tuvimos muchas idas y vueltas. Te paso con el personal del local para que te ayuden mejor. 👋";
    }

    session.messages.push({ role: "user", content: messageText });

    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...session.messages,
            ],
            max_tokens: 1024,
        });

        const botReply = response.choices[0].message.content;

        session.messages.push({ role: "assistant", content: botReply });

        // ── Pedido confirmado por el cliente → notificar al local y apagar bot ──
        if (botReply.match(/SOLICITUD[_\s]PEDIDO[:：]/i)) {
            await handleOrderRequest(phone, botReply);
            setHandoff(phone);
        }

        // ── Derivación a humano ──
        if (botReply.match(/DERIVAR[_\s]HUMANO[:：]/i)) {
            await handleHumanHandoff(phone, messageText, botReply);
            setHandoff(phone);
        }

        // Limpiar líneas técnicas antes de responder al cliente
        const cleanReply = botReply
            .replace(/SOLICITUD[_\s]PEDIDO[:：].*$/im, "")
            .replace(/DERIVAR[_\s]HUMANO[:：].*$/im, "")
            .trim();

        const greeting = isNewSession
            ? "¡Hola! Soy tu asistente virtual Tito 😊\n\n"
            : "";
        return greeting + cleanReply;
    } catch (error) {
        console.error("❌ Error en Groq:", error.message);
        return "Lo siento, tuve un problema técnico. Intentá de nuevo o llamanos al 472 28060. 🙏";
    }
}

// ─────────────────────────────────────────────
// NOTIFICAR SOLICITUD DE PEDIDO AL LOCAL
// ─────────────────────────────────────────────




async function handleOrderRequest(clientPhone, orderData) {
    try {
        const orderNumber = getOrderNumber();

        const { error } = await supabase.from("orders").insert({
            order_number: orderNumber,
            customer_name: orderData.nombre,
            customer_phone: clientPhone,
            type: orderData.tipo,
            address: orderData.direccion || null,
            items: orderData.items,
            subtotal: orderData.subtotal,
            total: orderData.total,
            status: "pending"
        });

        if (error) {
            console.error("❌ Error guardando pedido:", error);
        } else {
            console.log(`💾 Pedido ${orderNumber} guardado en DB`);
        }

    } catch (error) {
        console.error("❌ Error en handleOrderRequest:", error.message);
    }
}

// ─────────────────────────────────────────────
// NOTIFICAR DERIVACIÓN A HUMANO
// ─────────────────────────────────────────────
async function handleHumanHandoff(clientPhone, userMessage, botReply) {
    try {
        const match = botReply.match(/DERIVAR[_\s]HUMANO[:：]\s*(\{[\s\S]*?\})/i);
        
        let motivo = "sin_especificar";
        let resumen = null;

        if (match) {
            try {
                const data = JSON.parse(match[1]);
                motivo = data.motivo || motivo;
                resumen = data.resumen || null;
            } catch (parseError) {
                // El JSON falló pero igual derivamos — usamos lo que tenemos
                console.warn("⚠️ JSON de derivación inválido, derivando con datos mínimos:", parseError.message);
            }
        }

        let msg = `👤 *CLIENTE NECESITA ATENCIÓN*\n`;
        msg += `📞 ${clientPhone}\n`;
        msg += `🧠 Motivo: ${motivo}\n`;
        msg += `💬 Último mensaje: "${userMessage}"\n`;
        if (resumen) msg += `📋 Contexto: ${resumen}\n`;
        msg += `─────────────────\n`;
        msg += `👆 Tocá el número para atenderlo directamente.`;

        await sendMessage(process.env.OWNER_PHONE, msg);
        console.log(`📨 Derivación enviada al local (${motivo})`);

    } catch (error) {
        console.error("❌ Error en derivación:", error.message);
        // Fallback absoluto — el parse falló pero el cliente igual necesita atención
        await sendMessage(
            process.env.OWNER_PHONE,
            `👤 *CLIENTE NECESITA ATENCIÓN*\n📞 ${clientPhone}\n💬 Último mensaje: "${userMessage}"\n⚠️ Error al parsear señal de derivación.\n👆 Tocá el número para atenderlo.`
        );
    }
}

// ─────────────────────────────────────────────
// NOTIFICAR HANDOFF GENÉRICO (loop, etc.)
// ─────────────────────────────────────────────
async function notifyHandoff(clientPhone, motivo, detalle) {
    try {
        let msg = `⚠️ *BOT DESACTIVADO AUTOMÁTICAMENTE*\n`;
        msg += `📞 Cliente: ${clientPhone}\n`;
        msg += `🧠 Motivo: ${motivo}\n`;
        msg += `📋 Detalle: ${detalle}\n`;
        msg += `─────────────────\n`;
        msg += `👆 Tocá el número para atenderlo si es necesario.`;

        await sendMessage(process.env.OWNER_PHONE, msg);
    } catch (error) {
        console.error("❌ Error notificando handoff:", error.message);
    }
}

module.exports = { processMessage, getSession, setHandoff };