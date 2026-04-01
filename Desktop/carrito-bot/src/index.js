// =============================================
// SERVIDOR PRINCIPAL - Carrito del Paseo Bot
// =============================================

require("dotenv").config();

const express = require("express");
const { processMessage, getSession, setHandoff } = require("./bot");
const { sendMessage, downloadMedia, markAsRead } = require("./whatsapp");
const { transcribeAudio } = require("./transcribe");

const app = express();
app.use(express.json());

const processedMessages = new Set();

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        console.log("✅ Webhook verificado por Meta");
        return res.status(200).send(challenge);
    }
    console.warn("⚠️ Verificación de webhook fallida");
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
                const value = change.value;
                const messages = value?.messages;
                if (!messages?.length) continue;
                for (const message of messages) {
                    await handleIncomingMessage(message, value.metadata?.phone_number_id);
                }
            }
        }
    } catch (error) {
        console.error("❌ Error procesando webhook:", error);
    }
});

async function handleIncomingMessage(message, phoneNumberId) {
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
            console.log(`🎤 Transcribiendo audio...`);
            try {
                const { buffer, mimeType } = await downloadMedia(mediaId);
                const transcription = await transcribeAudio(buffer, mimeType);
                if (transcription) {
                    textToProcess = transcription;
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

    // Comando /bot NUMERO — el personal reactiva el bot para un cliente
    // Ejemplo: /bot 59899123456
    if (textToProcess.toLowerCase().startsWith("/bot") && from === process.env.OWNER_PHONE) {
        const parts = textToProcess.trim().split(" ");
        const targetPhone = parts[1] ? parts[1].trim() : from;
        const session = getSession(targetPhone);
        if (session) {
            session.status = "bot";
            session.messages = [];
            session.handoffAt = null;
            session.handoffNotified = false;
        }
        await sendMessage(from, `🤖 Bot reactivado para ${targetPhone}.`);
        return;
    }

    try {
        const reply = await processMessage(from, textToProcess);
        if (reply) {
            await sendMessage(from, reply);
        }
    } catch (error) {
        console.error(`❌ Error procesando mensaje de ${from}:`, error.message);
        await sendMessage(from, "Ups, tuve un problema técnico. Intentá de nuevo o llamanos al 472 28060. 🙏");
    }
}

app.get("/", (req, res) => {
    res.json({ status: "🟢 Online", service: "Carrito del Paseo Bot", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Carrito del Paseo Bot corriendo en puerto ${PORT}`);
    console.log(`\nVariables de entorno:`);
    console.log(`  WHATSAPP_TOKEN:       ${process.env.WHATSAPP_TOKEN ? "✅" : "❌ FALTA"}`);
    console.log(`  WHATSAPP_PHONE_ID:    ${process.env.WHATSAPP_PHONE_ID ? "✅" : "❌ FALTA"}`);
    console.log(`  WEBHOOK_VERIFY_TOKEN: ${process.env.WEBHOOK_VERIFY_TOKEN ? "✅" : "❌ FALTA"}`);
    console.log(`  GROQ_API_KEY:         ${process.env.GROQ_API_KEY ? "✅" : "❌ FALTA"}`);
    console.log(`  OWNER_PHONE:          ${process.env.OWNER_PHONE ? "✅" : "❌ FALTA"}`);
});