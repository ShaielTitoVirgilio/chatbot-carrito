require("dotenv").config();
const Groq = require("groq-sdk");
const { LOCAL_INFO, getMenuAsText } = require("./menu");
const supabase = require("./db");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────
// SESIONES
// ─────────────────────────────────────────────
const sessions = new Map();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const HANDOFF_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 40;

function getSession(phone) {
    const session = sessions.get(phone);
    if (!session) return null;
    const now = Date.now();
    if (session.status === "handoff" && now - session.handoffAt > HANDOFF_TIMEOUT_MS) {
        console.log(`⏰ Reactivando bot para ${phone}`);
        session.status = "bot";
        session.messages = [];
        session.handoffAt = null;
    }
    if (session.status === "bot" && now - session.lastActivity > SESSION_TIMEOUT_MS) {
        sessions.delete(phone);
        return null;
    }
    session.lastActivity = now;
    return session;
}

function createSession(phone) {
    const session = {
        status: "bot",
        messages: [],
        lastActivity: Date.now(),
        handoffAt: null,
    };
    sessions.set(phone, session);
    return session;
}

function setHandoff(phone) {
    const session = sessions.get(phone);
    if (session) {
        session.status = "handoff";
        session.handoffAt = Date.now();
        session.messages = [];
    }
}

// ─────────────────────────────────────────────
// HORARIO (20:00 – 02:00 hora Uruguay)
// ─────────────────────────────────────────────
function isOpen() {
    const hour = parseInt(
        new Date().toLocaleString("es-UY", {
            hour: "numeric",
            hour12: false,
            timeZone: "America/Montevideo",
        })
    );
    return hour >= 14 || hour < 2;
}

// ─────────────────────────────────────────────
// NUMERACIÓN DE PEDIDOS (se reinicia cada día)
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
Línea 1: Ahora te contacta alguien del local para responder eso. 👋
Línea 2: DERIVAR_HUMANO:{"motivo":"consulta_sin_respuesta","clientePhone":"[número real]","resumen":"[mensaje del cliente]"}

REGLA 1 — TONO:
Breve y directo. Sin frases de relleno ("¡Qué buena elección!", "Con gusto", "Perfecto", "Claro que sí"). Solo lo necesario.

REGLA 2 — TOMAR EL PEDIDO:
- Anotá los productos.
- Para productos con "+verduras a elección": preguntá "¿Con qué verduras lo querés? (lechuga, tomate, cebolla, morrón, pepino)"
- Si el cliente menciona una verdura que no existe en nuestra lista, corregilo.
- Si el cliente pide extras (+panceta, +huevo, +queso): confirmá cuál y sumá $50 por cada uno.
- Si el cliente pide sacar un ingrediente: anotalo como detalle. No preguntes sobre verduras si el cliente ya dijo que no quiere.
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

[nombre del producto][detalle si aplica] x[cant] — $[precio total con extras]

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

Respondé EXACTAMENTE en DOS partes separadas por una línea en blanco:

PARTE 1 (visible para el cliente):
"✅ Solicitud enviada. El personal del local te confirma el pedido en breve. 🙌"

PARTE 2 (solo JSON, sin texto antes ni después):
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
- No agregar texto antes ni después del JSON
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

Tu respuesta completa debe ser EXACTAMENTE estas dos líneas:
Línea 1: Ahora te contacta alguien del local. 👋
Línea 2: DERIVAR_HUMANO:{"motivo":"[motivo]","clientePhone":"[número real]","resumen":"[resumen]"}

REGLA 9 — NUNCA:
- Inventes tiempos de demora, precios de envío específicos, stock, ni ningún dato que no tenés.
- Uses frases de relleno.
- Confirmes el pedido como aceptado. Solo enviás la SOLICITUD, el personal decide.
- Escribas razonamiento interno o texto del sistema en el mensaje al cliente.
- Empieces tu respuesta con frases como "No inventes", "Según mis instrucciones", "Como asistente".

REGLA 10 — FORMATO DE RESPUESTA FINAL:
Cuando envíes el JSON del pedido, debe ser el ÚNICO contenido de esa parte.
No incluyas emojis, texto, explicaciones ni etiquetas junto al JSON.`;

// ─────────────────────────────────────────────
// PROCESO PRINCIPAL
// ─────────────────────────────────────────────
async function processMessage(phone, messageText) {
    let session = getSession(phone);
    const isNewSession = !session;
    if (!session) session = createSession(phone);

    if (session.status === "handoff") {
        console.log(`🤝 Handoff activo para ${phone}, ignorando mensaje`);
        return null;
    }

    if (!isOpen()) {
        return "🕐 En este momento estamos cerrados.\n\nNuestro horario es de *20:00 a 02:00 hs*. ¡Volvemos esta noche! 🍔";
    }

    if (session.messages.length >= MAX_MESSAGES) {
        await saveHandoff(phone, "loop_mensajes", "La sesión superó los 40 mensajes.", messageText);
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

        // Detectar JSON de pedido confirmado (tiene "items" y "clientePhone")
        const orderJsonMatch = botReply.match(/\{[\s\S]*?"items"[\s\S]*?"clientePhone"[\s\S]*?\}/);
        if (orderJsonMatch) {
            try {
                const orderData = JSON.parse(orderJsonMatch[0]);
                await handleOrderRequest(phone, orderData);
            } catch (e) {
                console.error("❌ Error parseando JSON de pedido:", e.message);
            }
            setHandoff(phone);
        }

        // Detectar derivación a humano
        const handoffMatch = botReply.match(/DERIVAR[_\s]HUMANO[:：]\s*(\{[\s\S]*?\})/i);
        if (handoffMatch) {
            try {
                const data = JSON.parse(handoffMatch[1]);
                await saveHandoff(phone, data.motivo || "sin_especificar", data.resumen || null, messageText);
            } catch {
                await saveHandoff(phone, "sin_especificar", null, messageText);
            }
            setHandoff(phone);
        }

        // Limpiar señales técnicas antes de responder al cliente
        const cleanReply = botReply
            .replace(/\{[\s\S]*?"items"[\s\S]*?"clientePhone"[\s\S]*?\}/, "")
            .replace(/DERIVAR[_\s]HUMANO[:：].*$/im, "")
            .trim();

        const greeting = isNewSession ? "¡Hola! Soy tu asistente virtual Tito 😊\n\n" : "";
        return greeting + cleanReply;

    } catch (error) {
        console.error("❌ Error en Groq:", error.message);
        return "Lo siento, tuve un problema técnico. Intentá de nuevo o llamanos al 472 28060. 🙏";
    }
}

// ─────────────────────────────────────────────
// GUARDAR PEDIDO EN SUPABASE
// ─────────────────────────────────────────────
async function handleOrderRequest(clientPhone, order) {
    const orderNumber = getOrderNumber();
    const { error } = await supabase.from("orders").insert({
        order_number: orderNumber,
        customer_name: order.nombre || null,
        customer_phone: clientPhone,
        contact_phone: order.telefono || null,
        type: order.tipo || null,
        address: order.direccion || null,
        items: order.items || [],
        subtotal: order.subtotal || 0,
        total: order.total || 0,
        status: "pending",
    });
    if (error) {
        console.error("❌ Error guardando pedido:", error.message);
    } else {
        console.log(`💾 Pedido ${orderNumber} guardado — cliente ${clientPhone}`);
    }
}

// ─────────────────────────────────────────────
// GUARDAR HANDOFF EN SUPABASE
// ─────────────────────────────────────────────
async function saveHandoff(clientPhone, motivo, resumen, lastMessage) {
    const { error } = await supabase.from("handoffs").insert({
        customer_phone: clientPhone,
        motivo,
        resumen,
        last_message: lastMessage,
        status: "pending",
    });
    if (error) {
        console.error("❌ Error guardando handoff:", error.message);
    } else {
        console.log(`📨 Handoff guardado — ${clientPhone} (${motivo})`);
    }
}

module.exports = { processMessage, getSession, setHandoff };
