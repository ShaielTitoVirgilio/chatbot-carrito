require("dotenv").config();
const Groq = require("groq-sdk");
const { LOCAL_INFO, getMenuAsText } = require("./menu");
const supabase = require("./db");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────
// SESIONES EN MEMORIA — solo para contexto del LLM
// El estado real (bot/handoff) vive en la DB.
// ─────────────────────────────────────────────
const sessions = new Map();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_MESSAGES = 40;

function getLLMSession(phone) {
    const session = sessions.get(phone);
    if (!session) return null;
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT_MS) {
        sessions.delete(phone);
        return null;
    }
    session.lastActivity = Date.now();
    return session;
}

function createLLMSession(phone) {
    const session = { messages: [], lastActivity: Date.now() };
    sessions.set(phone, session);
    return session;
}

function clearLLMSession(phone) {
    sessions.delete(phone);
}

// ─────────────────────────────────────────────
// HELPERS DB — conversaciones y mensajes
// ─────────────────────────────────────────────
async function saveMessage(phone, direction, content, { msgType = 'text', mediaUrl = null } = {}) {
    if (!content && !mediaUrl) return;
    await supabase.from("messages").insert({
        customer_phone: phone,
        direction,
        content: content || '',
        msg_type: msgType,
        media_url: mediaUrl,
    });
    await upsertConversationMeta(phone, direction, content || '📷 Imagen');
}

async function upsertConversationMeta(phone, direction, content) {
    const preview = content.length > 100 ? content.slice(0, 97) + "..." : content;
    const { data: existing } = await supabase
        .from("conversations")
        .select("id, unread_count")
        .eq("customer_phone", phone)
        .maybeSingle();

    if (existing) {
        const update = {
            last_message_at: new Date().toISOString(),
            last_message_preview: preview,
        };
        if (direction === "in") {
            update.unread_count = (existing.unread_count || 0) + 1;
        }
        await supabase.from("conversations").update(update).eq("customer_phone", phone);
    } else {
        await supabase.from("conversations").insert({
            customer_phone: phone,
            status: "bot",
            last_message_at: new Date().toISOString(),
            last_message_preview: preview,
            unread_count: direction === "in" ? 1 : 0,
        });
    }
}

async function isBotEnabled() {
    const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'bot_enabled')
        .maybeSingle();
    return data?.value !== 'false';
}

async function setBotEnabled(enabled) {
    await supabase
        .from('settings')
        .update({ value: enabled ? 'true' : 'false' })
        .eq('key', 'bot_enabled');
}

async function getConversationStatus(phone) {
    const { data } = await supabase
        .from("conversations")
        .select("status")
        .eq("customer_phone", phone)
        .maybeSingle();
    return data?.status || "bot";
}

async function setConversationStatus(phone, status, extra = {}) {
    await supabase
        .from("conversations")
        .update({ status, ...extra })
        .eq("customer_phone", phone);
    if (status === "bot") clearLLMSession(phone);
}

async function setCustomerName(phone, name) {
    if (!name) return;
    await supabase
        .from("conversations")
        .update({ customer_name: name })
        .eq("customer_phone", phone);
}

// ─────────────────────────────────────────────
// CLIENTES — persistencia de nombre y dirección
// ─────────────────────────────────────────────
async function getCustomer(phone) {
    const { data } = await supabase
        .from("customers")
        .select("nombre, direccion")
        .eq("phone", phone)
        .maybeSingle();
    return data || null;
}

async function upsertCustomer(phone, { nombre, direccion } = {}) {
    const update = {};
    if (nombre) update.nombre = nombre;
    if (direccion) update.direccion = direccion;
    if (!Object.keys(update).length) return;

    const { data: existing } = await supabase
        .from("customers")
        .select("nombre, direccion")
        .eq("phone", phone)
        .maybeSingle();

    if (existing) {
        await supabase.from("customers").update(update).eq("phone", phone);
    } else {
        await supabase.from("customers").insert({ phone, ...update });
    }
}

// ─────────────────────────────────────────────
// HORARIO (14:00 – 02:00 hora Uruguay)
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
async function buildSystemPrompt(customerData = null) {
    const menuText = await getMenuAsText();
    const clienteConocido = customerData
        ? `\n---\n👤 DATOS GUARDADOS DEL CLIENTE:\n- Nombre: ${customerData.nombre || "desconocido"}\n- Dirección: ${customerData.direccion || "no tiene"}\n---\n`
        : "";
    return `Sos el asistente de pedidos de *Carrito del Paseo*, Paysandú, Uruguay.${clienteConocido}
Tu único rol es tomar pedidos y responder preguntas básicas del local.

---
📍 DATOS DEL LOCAL:
- Dirección: ${LOCAL_INFO.direccion}
- Teléfono: ${LOCAL_INFO.telefono}
- Horarios: ${LOCAL_INFO.horarios}
- Delivery: ${LOCAL_INFO.delivery.zona}. Costo base: $${LOCAL_INFO.delivery.costo} (puede variar según distancia)
- Pago delivery: efectivo o transferencia
- Pago retiro en local: efectivo o débito
- Retiro en local: sin costo adicional
---

📋 MENÚ (precios en pesos uruguayos):
${menuText}

PAPAS FRITAS: Si el cliente pide "una bandeja de papas", "bandeja de fritas" o similar, anotalo directamente como Papas fritas grandes — no preguntes el tamaño.

PANCHOS: Todos los panchos son de marca Shneck — nunca preguntes la marca ni el tipo de calidad. Las únicas variantes son las que aparecen en el menú (solo, con papitas, con muzzarella, con panceta, con panceta y muzzarella). Si el cliente pide "un pancho" sin especificar, preguntá solo cuál variante quiere.

EXTRAS disponibles (solo para hamburguesas que NO dicen "Completa"):
+panceta extra, +huevo frito extra, +queso cheddar.
Si el cliente pide un extra en una hamburguesa "Completa", informale que esa ya viene completa y no aplican extras.

VERDURAS DISPONIBLES (solo estas, no hay otras):
lechuga, tomate, cebolla, choclo, arveja, aceituna, morrones, hongos, ajíes y pickles.
Si el cliente pide una verdura que NO está en esa lista, decile que no tenemos esa verdura y preguntale cuáles de las disponibles quiere.

---

🔴 REGLAS — LEELAS TODAS ANTES DE RESPONDER:

REGLA 0 — LO MÁS IMPORTANTE:
Si el cliente pregunta algo que NO podés responder con los datos que tenés (demoras, precios de envío a direcciones específicas, ofertas, stock, si llegan a cierto barrio, etc.) NO inventes ni estimes. Tu respuesta completa debe ser EXACTAMENTE esto, sin agregar nada más:
Ahora te contacta alguien del local para responder eso. 👋
DERIVAR_HUMANO:{"motivo":"consulta_sin_respuesta","clientePhone":"[número real]","resumen":"[mensaje del cliente]"}

REGLA 1 — TONO:
Breve y directo. Sin frases de relleno ("¡Qué buena elección!", "Con gusto", "Perfecto", "Claro que sí"). Solo lo necesario.

REGLA 2 — TOMAR EL PEDIDO:
- Anotá los productos.
- Para productos con "+verduras a elección": preguntá "¿Con qué verduras lo querés? (lechuga, tomate, cebolla, choclo, arveja, aceituna, morrones, hongos, ajíes, pickles)"
- Si el cliente menciona una verdura que no existe en nuestra lista, corregilo.
- Si el cliente pide extras (+panceta extra, +huevo frito extra, +queso cheddar): solo aplican en hamburguesas que NO dicen "Completa". Confirmá cuál quiere y sumalo al pedido.
- Si el cliente pide sacar un ingrediente: anotalo como detalle. No preguntes sobre verduras si el cliente ya dijo que no quiere.
- Preguntá UNA SOLA VEZ si quiere agregar algo más al pedido.
- NUNCA asumas la variante de un producto cuando hay más de una opción de tamaño o tipo. Si el cliente pide "papas fritas" sin especificar, preguntá: "¿Las querés pequeñas ($65), medianas ($115) o grandes ($195)?" Lo mismo aplica para cualquier otro producto con variantes (panchos, sándwiches, etc.). Solo anotá el producto cuando el cliente confirmó la variante exacta.

REGLA 3 — RETIRO O DELIVERY:
Cuando el pedido esté completo, preguntá:
"¿Es para retirar o envío a domicilio?
1️⃣ Retirar en el local
2️⃣ Envío a domicilio"

REGLA 4 — DATOS NECESARIOS:
- RETIRAR: preguntá solo "¿A qué nombre va el pedido?" Una vez que tenés el nombre, preguntá: "¿Pagás con efectivo o débito?"
- DELIVERY: pedí los 3 datos juntos:
  "Necesito estos datos:
  • Nombre
  • Dirección
  • Teléfono de contacto"
  No avances hasta tener los 3. Si falta alguno, pedí solo el que falta. Una vez que los tenés, preguntá: "¿Pagás con efectivo o transferencia?" (dejá en claro que efectivo es la opción por defecto si no responde).

MEDIOS DE PAGO VÁLIDOS:
- Retiro: efectivo o débito. Si el cliente pide otro medio (tarjeta crédito, transferencia, MercadoPago, etc.), hacé handoff:
  Ahora te contacta alguien del local para coordinar el pago. 👋
  DERIVAR_HUMANO:{"motivo":"medio_de_pago_no_disponible","clientePhone":"[número real]","resumen":"El cliente quiere pagar con [medio solicitado] en retiro"}
- Delivery: efectivo o transferencia. Si el cliente pide otro medio, hacé handoff igual.

REGLA 4B — DATOS GUARDADOS DEL CLIENTE:
Si tenés DATOS GUARDADOS DEL CLIENTE (sección al inicio del prompt):
- Si elige DELIVERY y tiene dirección guardada, preguntá: "¿Te lo enviamos a [dirección] a nombre de [nombre]? Si querés cambiarlo, decime."
  - Si confirma, usá esos datos directamente sin pedir nada más.
  - Si quiere cambiar, pedí el dato que quiere cambiar.
- Si elige DELIVERY y tiene nombre pero no dirección, pedí solo la dirección (y el teléfono si no lo tenés).
- Si elige RETIRO y tiene nombre guardado, preguntá: "¿Va a nombre de [nombre]?" — si confirma, usalo directamente.

REGLA 5 — RESUMEN:
Cuando tenés TODOS los datos mostrá exactamente este formato:

📋 *SOLICITUD DE PEDIDO*

[nombre del producto][detalle si aplica] x[cant] — $[precio total con extras]

Subtotal: $XXX
[si delivery] Envío: $50 aprox
*TOTAL ESTIMADO: $XXX*

[si retiro] 🏪 Retiro en local — A nombre de: [nombre]
[si delivery] 🚚 Envío a: [dirección] — Contacto: [nombre] / [teléfono]
💵 Pago: [medio de pago elegido]

¿Los datos son correctos?
✅ Respondé *SÍ* para enviar la solicitud al local
❌ Respondé *NO* para corregir algo

REGLA 6 — CONFIRMACIÓN DEL CLIENTE (dice "sí", "si", "confirmar", "dale", "ok", "correcto", "está bien"):

Respondé EXACTAMENTE en DOS partes separadas por una línea en blanco. NADA MÁS — no agregues preguntas, comentarios ni texto de ningún tipo después del JSON:

PARTE 1 (visible para el cliente):
"✅ Recibimos tu solicitud. Ahora el personal del local revisa el pedido y te confirma en breve. 🙌"

PARTE 2 (solo JSON, sin texto antes ni después — y NADA después del JSON):
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
  "pago": "efectivo" o "debito" o "transferencia",
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

Tu respuesta completa debe ser EXACTAMENTE esto:
Ahora te contacta alguien del local. 👋
DERIVAR_HUMANO:{"motivo":"[motivo]","clientePhone":"[número real]","resumen":"[resumen]"}

REGLA 9 — NUNCA:
- Inventes tiempos de demora, precios de envío específicos, stock, ni ningún dato que no tenés.
- Uses frases de relleno.
- Confirmes el pedido como aceptado. Solo enviás la SOLICITUD, el personal decide.
- Escribas razonamiento interno o texto del sistema en el mensaje al cliente.
- Empieces tu respuesta con frases como "No inventes", "Según mis instrucciones", "Como asistente".
- Preguntes al cliente cuánto tiempo tiene o cuándo quiere el pedido. Eso lo maneja el personal.

REGLA 10 — FORMATO DE RESPUESTA FINAL:
Cuando envíes el JSON del pedido, debe ser el ÚNICO contenido de esa parte.
No incluyas emojis, texto, explicaciones ni etiquetas junto al JSON.`;
}

// ─────────────────────────────────────────────
// PROCESO PRINCIPAL
// ─────────────────────────────────────────────
async function processMessage(phone, messageText) {
    // 1. Persistir siempre el mensaje entrante (aunque estemos en handoff)
    await saveMessage(phone, "in", messageText);

    // 2. Chequear si el bot está habilitado globalmente
    const botEnabled = await isBotEnabled();
    if (!botEnabled) {
        console.log(`🔴 Bot desactivado — mensaje de ${phone} guardado para el panel`);
        return null;
    }

    // 3. Chequear estado real desde DB
    const status = await getConversationStatus(phone);

    // Si hay humano atendiendo, el bot no responde — pero el msg ya quedó guardado.
    if (status === "handoff") {
        console.log(`🤝 Handoff activo para ${phone}, mensaje guardado para el panel`);
        return null;
    }

    // Fuera de horario
    if (!isOpen()) {
        const msg = "🕐 En este momento estamos cerrados.\n\nNuestro horario es de *14:00 a 02:00 hs*. ¡Volvemos esta noche! 🍔";
        await saveMessage(phone, "bot", msg);
        return msg;
    }

    // 3. Buscar datos guardados del cliente
    const customerData = await getCustomer(phone);

    // 4. Sesión LLM (contexto de conversación)
    let session = getLLMSession(phone);
    const isNewSession = !session;
    if (!session) session = createLLMSession(phone);

    // Límite de mensajes → derivar
    if (session.messages.length >= MAX_MESSAGES) {
        await setConversationStatus(phone, "handoff");
        const msg = "Parece que tuvimos muchas idas y vueltas. Te paso con el personal del local para que te ayuden mejor. 👋";
        await saveMessage(phone, "bot", msg);
        return msg;
    }

    session.messages.push({ role: "user", content: messageText });

    try {
        const SYSTEM_PROMPT = await buildSystemPrompt(customerData);
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

        // Detectar JSON de pedido confirmado
        let cleanReply;
        const orderJsonMatch = botReply.match(/\{[\s\S]*?"items"[\s\S]*?"clientePhone"[\s\S]*?\}/);
        if (orderJsonMatch) {
            try {
                const orderData = JSON.parse(orderJsonMatch[0]);
                await handleOrderRequest(phone, orderData);
                if (orderData.nombre) await setCustomerName(phone, orderData.nombre);
            } catch (e) {
                console.error("❌ Error parseando JSON de pedido:", e.message);
            }
            await setConversationStatus(phone, "handoff");
            // Solo usar el texto ANTES del JSON — ignorar cualquier cosa extra que el LLM agregue después
            cleanReply = botReply.slice(0, orderJsonMatch.index).trim();
        } else {
            // Detectar derivación
            const handoffMatch = botReply.match(/DERIVAR[_\s]HUMANO[:：]\s*(\{[\s\S]*?\})/i);
            if (handoffMatch) {
                await setConversationStatus(phone, "handoff");
            }

            // Limpiar señales técnicas
            cleanReply = botReply
                .replace(/DERIVAR[_\s]HUMANO[:：].*$/im, "")
                .trim();
        }

        const greeting = isNewSession ? "¡Hola! Soy tu asistente virtual Tito 😊\n\n" : "";
        const finalReply = greeting + cleanReply;

        // Guardar respuesta del bot
        if (finalReply) await saveMessage(phone, "bot", finalReply);

        return finalReply;

    } catch (error) {
        console.error("❌ Error en Groq:", error.message);
        const msg = "Lo siento, tuve un problema técnico. Intentá de nuevo o llamanos al 472 28060. 🙏";
        await saveMessage(phone, "bot", msg);
        return msg;
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
        payment_method: order.pago || "efectivo",
        status: "pending",
    });
    if (error) {
        console.error("❌ Error guardando pedido:", error.message);
    } else {
        console.log(`💾 Pedido ${orderNumber} guardado — cliente ${clientPhone}`);
    }

    // Persistir datos del cliente para futuros pedidos
    await upsertCustomer(clientPhone, {
        nombre: order.nombre || null,
        direccion: order.tipo === "delivery" ? (order.direccion || null) : null,
    });
}

module.exports = {
    processMessage,
    saveMessage,
    setConversationStatus,
    clearLLMSession,
    isBotEnabled,
    setBotEnabled,
};
