// =============================================
// SERVIDOR PRINCIPAL - Carrito del Paseo Bot
// =============================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const {
    processMessage,
    saveMessage,
    setConversationStatus,
    clearLLMSession,
    isBotEnabled,
    setBotEnabled,
} = require("./bot");
const { sendMessage, downloadMedia, markAsRead } = require("./whatsapp");
const { transcribeAudio } = require("./transcribe");
const supabase = require("./db");
const { buildOrderMessage, buildWhatsappLink } = require("./messages");
const webRoutes = require("./web/routes");
const { cors: webCors } = require("./web/middleware");

const MEDIA_SIGNED_URL_TTL = 3600; // 1 hora: alcanza para que el panel la muestre

// Antes se guardaba la URL publica completa; ahora se guarda solo el path
// dentro del bucket. Se soportan ambos formatos para no romper mensajes viejos.
function mediaPathFromStored(value) {
    if (!value) return null;
    if (!value.startsWith("http")) return value;
    const marker = "/whatsapp-media/";
    const i = value.indexOf(marker);
    return i === -1 ? null : value.slice(i + marker.length);
}

async function resolveMediaUrls(messages) {
    const conPath = messages
        .map(m => ({ m, path: m.msg_type === "image" ? mediaPathFromStored(m.media_url) : null }))
        .filter(x => x.path);
    if (!conPath.length) return messages;

    const firmadas = await Promise.all(conPath.map(async ({ m, path }) => {
        const { data, error } = await supabase.storage
            .from("whatsapp-media")
            .createSignedUrl(path, MEDIA_SIGNED_URL_TTL);
        return { id: m.id, url: error ? null : data.signedUrl };
    }));
    const byId = new Map(firmadas.map(f => [f.id, f.url]));

    return messages.map(m => byId.has(m.id) ? { ...m, media_url: byId.get(m.id) } : m);
}

const app = express();

// Railway corre detras de un proxy: sin esto req.ip es la del proxy y el
// rate limiting de /api/web limitaria a todos los clientes como si fueran uno.
app.set("trust proxy", 1);

app.use(express.json({ limit: "100kb" }));

const processedMessages = new Set();

// ─────────────────────────────────────────────
// AUTH BÁSICA PARA PANEL Y API
// ─────────────────────────────────────────────
const PANEL_USER = process.env.PANEL_USER;
const PANEL_PASS = process.env.PANEL_PASS;

// Sin credenciales no se arranca: el panel expone nombres, telefonos y
// direcciones de clientes. Antes habia defaults "admin"/"123456".
if (!PANEL_USER || !PANEL_PASS) {
    console.error("\n❌ Faltan PANEL_USER y/o PANEL_PASS en las variables de entorno.");
    console.error("   El panel expone datos personales de clientes; no se arranca sin credenciales.\n");
    process.exit(1);
}

// Comparacion en tiempo constante: evita filtrar la password por timing.
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a), "utf8");
    const bufB = Buffer.from(String(b), "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
        const decoded = Buffer.from(encoded, "base64").toString();
        const sep = decoded.indexOf(":");   // la password puede contener ":"
        const user = sep === -1 ? decoded : decoded.slice(0, sep);
        const pass = sep === -1 ? "" : decoded.slice(sep + 1);
        // & (no &&) para que ambas comparaciones corran siempre: mismo tiempo
        // exista o no el usuario.
        if (safeEqual(user, PANEL_USER) & safeEqual(pass, PANEL_PASS)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Panel Carrito", charset="UTF-8"');
    res.status(401).send("Autenticación requerida");
}

// ─────────────────────────────────────────────
// WEBHOOK WHATSAPP
// ─────────────────────────────────────────────
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook verificado por Meta");
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
    res.sendStatus(200);
    try {
        const body = req.body;
        if (body.object !== "whatsapp_business_account") return;
        for (const entry of body.entry || []) {
            for (const change of entry.changes || []) {
                if (change.field !== "messages") continue;
                for (const message of change.value?.messages || []) {
                    await handleIncomingMessage(message);
                }
            }
        }
    } catch (error) {
        console.error("❌ Error procesando webhook:", error.message);
    }
});

async function handleIncomingMessage(message) {
    const messageId = message.id;
    const from = message.from;
    const type = message.type;

    if (processedMessages.has(messageId)) return;
    processedMessages.add(messageId);
    if (processedMessages.size > 500) {
        processedMessages.delete(processedMessages.values().next().value);
    }

    console.log(`📩 Mensaje de ${from} (tipo: ${type})`);
    await markAsRead(messageId);

    let textToProcess = null;

    if (type === "text") {
        textToProcess = message.text?.body?.trim();
    } else if (type === "audio") {
        const mediaId = message.audio?.id;
        if (mediaId) {
            try {
                const { buffer, mimeType } = await downloadMedia(mediaId);
                const transcription = await transcribeAudio(buffer, mimeType);
                if (transcription) {
                    textToProcess = `🎤 ${transcription}`;
                } else {
                    await sendMessage(from, "🙏 No pude entender el audio. ¿Podés escribirme?");
                    return;
                }
            } catch {
                await sendMessage(from, "🙏 Tuve un problema con el audio. ¿Podés escribirme?");
                return;
            }
        }
    } else if (type === "image") {
        const mediaId = message.image?.id;
        if (mediaId) {
            try {
                const { buffer, mimeType } = await downloadMedia(mediaId);
                const ext = mimeType?.includes("png") ? "png" : "jpg";
                // Nombre aleatorio: antes era `${telefono}_${timestamp}`, con lo
                // cual conociendo el numero de un cliente se podia barrer sus
                // fotos por fuerza bruta. El bucket ademas es privado (ver db.js).
                const fileName = `${crypto.randomUUID()}.${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from("whatsapp-media")
                    .upload(fileName, buffer, { contentType: mimeType || "image/jpeg", upsert: false });
                if (uploadError) throw uploadError;
                // Se guarda el PATH, no una URL publica: el bucket es privado y
                // las URLs se firman al vuelo cuando el panel las pide.
                await saveMessage(from, "in", message.image?.caption || "", { msgType: "image", mediaUrl: fileName });
                const caption = message.image?.caption ? ` con el texto: "${message.image.caption}"` : "";
                await sendMessage(from, `📷 Foto recibida${caption}. El personal la va a ver en seguida. 👍`);
            } catch (e) {
                console.error("❌ Error procesando imagen:", e.message);
                await sendMessage(from, "📷 Recibimos tu imagen pero hubo un problema al guardarla. Intentá de nuevo. 🙏");
            }
        }
        return;
    } else {
        const unsupported = ["video", "document", "sticker", "location", "reaction"];
        if (unsupported.includes(type)) {
            await sendMessage(from, "Solo proceso mensajes de texto, audios e imágenes. ¿En qué te puedo ayudar? 😊");
        }
        return;
    }

    if (!textToProcess) return;

    try {
        const reply = await processMessage(from, textToProcess);
        if (reply) await sendMessage(from, reply);
    } catch (error) {
        console.error(`❌ Error procesando mensaje de ${from}:`, error.message);
        await sendMessage(from, "Ups, tuve un problema técnico. Intentá de nuevo o llamanos al 472 28060. 🙏");
    }
}

// ─────────────────────────────────────────────
// API PUBLICA DE LA WEB DE PEDIDOS
// ─────────────────────────────────────────────
// Va antes del basicAuth: es la unica parte de /api que es publica.
app.use("/api/web", webCors, webRoutes);

// ─────────────────────────────────────────────
// PANEL
// ─────────────────────────────────────────────
// /api/web/* es publico (lo consume la web de pedidos); el resto exige panel.
// Escrito como allowlist invertida a proposito: cualquier endpoint nuevo que no
// sea /api/web queda protegido solo, sin tener que acordarse de agregarlo.
app.use("/api", (req, res, next) =>
    req.path.startsWith("/web/") ? next() : basicAuth(req, res, next));
app.get("/privacidad", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/privacidad.html"));
});
app.get("/eliminar-datos", (req, res) => {
    res.redirect("/privacidad");
});
app.post("/eliminar-datos", (req, res) => {
    // Meta envía signed_request con el user_id a eliminar
    // Para una app de WhatsApp Business sin login de Facebook, no hay datos de usuario de Facebook
    const confirmationCode = `del_${Date.now()}`;
    res.json({
        url: "https://chatbot-carrito-production.up.railway.app/privacidad",
        confirmation_code: confirmationCode,
    });
});
app.get("/panel", basicAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../public/panel.html"));
});
app.use(basicAuth, express.static(path.join(__dirname, "../public")));

// ─────────────────────────────────────────────
// API — CONVERSACIONES
// ─────────────────────────────────────────────
app.get("/api/conversations", async (req, res) => {
    const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(100);
    if (error) return res.status(500).json({ error: error.message });

    // Enriquecer con pedido pendiente/confirmado si hay
    const phones = data.map(c => c.customer_phone);
    let activeOrders = [];
    if (phones.length) {
        const { data: ordersData } = await supabase
            .from("orders")
            .select("*")
            .in("customer_phone", phones)
            .in("status", ["pending", "confirmed"])
            .order("created_at", { ascending: false });
        activeOrders = ordersData || [];
    }
    const byPhone = {};
    for (const o of activeOrders) {
        if (!byPhone[o.customer_phone]) byPhone[o.customer_phone] = o;
    }
    const enriched = data.map(c => ({ ...c, active_order: byPhone[c.customer_phone] || null }));
    res.json(enriched);
});

app.get("/api/conversations/:phone", async (req, res) => {
    const phone = req.params.phone;
    const [convRes, msgsRes, ordersRes] = await Promise.all([
        supabase.from("conversations").select("*").eq("customer_phone", phone).maybeSingle(),
        supabase.from("messages").select("*").eq("customer_phone", phone).order("created_at", { ascending: true }),
        supabase.from("orders").select("*").eq("customer_phone", phone).order("created_at", { ascending: false }),
    ]);

    if (convRes.error) return res.status(500).json({ error: convRes.error.message });
    if (!convRes.data) return res.status(404).json({ error: "Conversación no encontrada" });

    const messages = await resolveMediaUrls(msgsRes.data || []);
    const orders = ordersRes.data || [];
    const activeOrder = orders.find(o => o.status === "pending" || o.status === "confirmed") || null;

    res.json({
        conversation: convRes.data,
        messages,
        orders,
        active_order: activeOrder,
    });
});

app.post("/api/conversations/:phone/mark-read", async (req, res) => {
    const { error } = await supabase
        .from("conversations")
        .update({ unread_count: 0 })
        .eq("customer_phone", req.params.phone);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

app.post("/api/conversations/:phone/reply", async (req, res) => {
    const phone = req.params.phone;
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Contenido vacío" });
    try {
        await sendMessage(phone, content);
        await saveMessage(phone, "human", content);
        // Asegurar que quede en handoff (el empleado está atendiendo)
        await setConversationStatus(phone, "handoff");
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/conversations/:phone/status", async (req, res) => {
    const phone = req.params.phone;
    const { status } = req.body;
    if (!["bot", "handoff"].includes(status)) {
        return res.status(400).json({ error: "Status inválido" });
    }
    await setConversationStatus(phone, status);
    if (status === "bot") clearLLMSession(phone);
    res.json({ ok: true });
});

// ─────────────────────────────────────────────
// API — PEDIDOS
// ─────────────────────────────────────────────
// Tablero del panel: pedidos de los dos canales en una sola lista.
app.get("/api/orders", async (req, res) => {
    // Por defecto, lo del dia comercial en curso (corta a las 06:00 local),
    // asi el turno de la noche no se mezcla con el del dia anterior.
    const desde = req.query.desde || new Date(Date.now() - 18 * 3600_000).toISOString();

    let q = supabase.from("orders").select("*").gte("created_at", desde);
    if (req.query.canal) q = q.eq("channel", req.query.canal);
    if (req.query.estado) q = q.in("status", String(req.query.estado).split(","));

    const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Confirmar: aca el empleado fija el envio real y la demora acordada.
// El total se recalcula en el server (items_total + envio), nunca se toma
// el numero que mande el navegador.
app.post("/api/orders/:id/confirm", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders").select("*").eq("id", req.params.id).single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    const itemsTotal = Number(order.items_total ?? order.subtotal ?? order.total ?? 0);
    const envio = Math.max(0, Number(req.body?.delivery_fee) || 0);
    const eta = Number(req.body?.eta_minutes) > 0 ? Math.round(Number(req.body.eta_minutes)) : null;

    const patch = {
        status: "confirmed",
        delivery_fee: envio,
        items_total: itemsTotal,
        total: itemsTotal + envio,
        eta_minutes: eta,
        confirmed_at: new Date().toISOString(),
    };

    const { error: upError } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (upError) return res.status(500).json({ error: upError.message });

    await notificar({ ...order, ...patch }, "confirmed", res);
});

// Listo / En camino, segun sea retiro o delivery.
app.post("/api/orders/:id/ready", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders").select("*").eq("id", req.params.id).single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    const status = order.type === "delivery" ? "on_the_way" : "ready";
    const { error: upError } = await supabase
        .from("orders").update({ status, ready_at: new Date().toISOString() }).eq("id", order.id);
    if (upError) return res.status(500).json({ error: upError.message });

    await notificar({ ...order, status }, "ready", res);
});

app.post("/api/orders/:id/delivered", async (req, res) => {
    const { error } = await supabase.from("orders")
        .update({ status: "delivered", delivered_at: new Date().toISOString() })
        .eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, status: "delivered" });
});

// Rechazar con motivo. El motivo se guarda y se le muestra al cliente.
app.post("/api/orders/:id/reject", async (req, res) => {
    const motivo = String(req.body?.motivo || "").trim().slice(0, 200);
    if (!motivo) return res.status(400).json({ error: "Falta el motivo" });

    const { data: order, error } = await supabase
        .from("orders").select("*").eq("id", req.params.id).single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    const patch = { status: "rejected", rejected_reason: motivo, rejected_at: new Date().toISOString() };
    const { error: upError } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (upError) return res.status(500).json({ error: upError.message });

    await notificar({ ...order, ...patch }, "rejected", res);
});

// Aviso al cliente: best-effort. Con Meta bloqueado esto siempre falla, y
// justamente por eso se responde con el link de WhatsApp para que el empleado
// lo mande a mano desde su telefono.
async function notificar(order, mensaje, res) {
    const texto = buildOrderMessage(order, mensaje);
    let notified = false;
    try {
        await sendMessage(order.customer_phone, texto);
        await saveMessage(order.customer_phone, "human", texto);
        notified = true;
    } catch (e) {
        console.warn(`⚠️ ${order.order_number} → ${order.status}, sin avisar: ${e.message}`);
    }
    const wa = buildWhatsappLink(order, mensaje);
    res.json({ ok: true, status: order.status, notified, wa_url: wa?.url || null });
}

// Link de WhatsApp con el texto ya escrito, para que el empleado abra el chat.
app.get("/api/orders/:id/wa-link", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", req.params.id)
        .single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    const estado = req.query.estado || "new";
    let wa;
    try {
        wa = buildWhatsappLink(order, estado);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    if (!wa) return res.status(422).json({ error: "El pedido no tiene un teléfono válido" });
    res.json(wa);
});

app.post("/api/orders/:id/takeover", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders")
        .select("customer_phone")
        .eq("id", req.params.id)
        .single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    await Promise.all([
        supabase.from("orders").update({ status: "manual" }).eq("id", req.params.id),
        setConversationStatus(order.customer_phone, "handoff"),
    ]);
    res.json({ ok: true });
});

// ─────────────────────────────────────────────
// API — BOT ON/OFF
// ─────────────────────────────────────────────
app.get("/api/bot/status", async (req, res) => {
    const enabled = await isBotEnabled();
    res.json({ enabled });
});

app.post("/api/bot/toggle", async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "Campo 'enabled' requerido (boolean)" });
    await setBotEnabled(enabled);
    console.log(`${enabled ? "🟢" : "🔴"} Bot ${enabled ? "activado" : "desactivado"} manualmente`);
    res.json({ ok: true, enabled });
});

// ─────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
    res.json({ status: "🟢 Online", service: "Carrito del Paseo Bot", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Carrito del Paseo Bot corriendo en puerto ${PORT}`);
    console.log(`📊 Panel: http://localhost:${PORT}/panel`);
    console.log(`\nVariables de entorno:`);
    console.log(`  WHATSAPP_TOKEN:       ${process.env.WHATSAPP_TOKEN ? "✅" : "❌ FALTA"}`);
    console.log(`  WHATSAPP_PHONE_ID:    ${process.env.WHATSAPP_PHONE_ID ? "✅" : "❌ FALTA"}`);
    console.log(`  WEBHOOK_VERIFY_TOKEN: ${process.env.WEBHOOK_VERIFY_TOKEN ? "✅" : "❌ FALTA"}`);
    console.log(`  GROQ_API_KEY:         ${process.env.GROQ_API_KEY ? "✅" : "❌ FALTA"}`);
    console.log(`  SUPABASE_URL:         ${process.env.SUPABASE_URL ? "✅" : "❌ FALTA"}`);
});
