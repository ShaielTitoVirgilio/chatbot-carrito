// =============================================
// SERVIDOR PRINCIPAL - Carrito del Paseo Bot
// =============================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const {
    processMessage,
    saveMessage,
    setConversationStatus,
    clearLLMSession,
} = require("./bot");
const { sendMessage, downloadMedia, markAsRead } = require("./whatsapp");
const { transcribeAudio } = require("./transcribe");
const supabase = require("./db");

const app = express();
app.use(express.json());

const LOCAL_ADDRESS = "Zorrilla de San Martín 1835, Paysandú";
const processedMessages = new Set();

// ─────────────────────────────────────────────
// AUTH BÁSICA PARA PANEL Y API
// ─────────────────────────────────────────────
const PANEL_USER = process.env.PANEL_USER || "admin";
const PANEL_PASS = process.env.PANEL_PASS || "123456";

function basicAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
        const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
        if (user === PANEL_USER && pass === PANEL_PASS) return next();
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
    } else {
        const unsupported = ["image", "video", "document", "sticker", "location", "reaction"];
        if (unsupported.includes(type)) {
            await sendMessage(from, "Solo proceso mensajes de texto y audios. ¿En qué te puedo ayudar? 😊");
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
// PANEL
// ─────────────────────────────────────────────
app.use("/api", basicAuth);
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

    const orders = ordersRes.data || [];
    const activeOrder = orders.find(o => o.status === "pending" || o.status === "confirmed") || null;

    res.json({
        conversation: convRes.data,
        messages: msgsRes.data || [],
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
app.post("/api/orders/:id/confirm", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", req.params.id)
        .single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    const minutes = req.body?.minutes || 30;
    let msg = `✅ *Pedido ${order.order_number} confirmado!*\n\n`;
    msg += `Hola ${order.customer_name || ""}, ya lo estamos preparando.\n\n`;
    if (order.type === "delivery") {
        msg += `🚚 Te lo enviamos a: ${order.address}\n`;
        msg += `⏱ Tiempo estimado: ~${minutes} minutos\n`;
        msg += `💵 Total a pagar: $${order.total} (efectivo)`;
    } else {
        msg += `🏪 Podés retirar en: ${LOCAL_ADDRESS}\n`;
        msg += `⏱ Estará listo en ~${minutes} minutos\n`;
        msg += `💵 Total: $${order.total}`;
    }

    try {
        await sendMessage(order.customer_phone, msg);
        await saveMessage(order.customer_phone, "human", msg);
        await supabase.from("orders").update({ status: "confirmed" }).eq("id", order.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/orders/:id/ready", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", req.params.id)
        .single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    let msg = `🏁 *Pedido ${order.order_number} listo!*\n\n`;
    if (order.type === "delivery") {
        msg += `🏍 Ya sale en camino a: ${order.address}\n`;
        msg += `💵 Tené $${order.total} en efectivo a mano.`;
    } else {
        msg += `🏪 Pasá a retirarlo cuando quieras por ${LOCAL_ADDRESS}.\n`;
        msg += `💵 Total: $${order.total}`;
    }

    try {
        await sendMessage(order.customer_phone, msg);
        await saveMessage(order.customer_phone, "human", msg);
        await supabase.from("orders").update({ status: "done" }).eq("id", order.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/orders/:id/cancel", async (req, res) => {
    const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", req.params.id)
        .single();
    if (error || !order) return res.status(404).json({ error: "Pedido no encontrado" });

    const reason = req.body?.reason?.trim();
    let msg = `❌ *Pedido ${order.order_number} cancelado*\n\n`;
    msg += reason
        ? `Motivo: ${reason}\n\nSi querés podemos arreglar algo distinto.`
        : `No pudimos tomar tu pedido esta vez. Disculpá las molestias 🙏`;

    try {
        await sendMessage(order.customer_phone, msg);
        await saveMessage(order.customer_phone, "human", msg);
        await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
