// =============================================
// MÓDULO DE WHATSAPP - Envío de mensajes
// Usa la API oficial de Meta WhatsApp Business
// =============================================

const axios = require("axios");

const BASE_URL = "https://graph.facebook.com/v19.0";

/**
 * Envía un mensaje de texto a un número de WhatsApp
 * @param {string} to - Número destino en formato internacional (ej: 59899123456)
 * @param {string} text - Texto del mensaje
 */
async function sendMessage(to, text) {
    try {
        const response = await axios.post(
            `${BASE_URL}/${process.env.WHATSAPP_PHONE_ID}/messages`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "text",
                text: { body: text },
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log(`✅ Mensaje enviado a ${to}`);
        return response.data;
    } catch (error) {
        console.error(`❌ Error enviando mensaje a ${to}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Descarga un archivo de media de WhatsApp (para audios)
 * @param {string} mediaId - ID del media a descargar
 * @returns {Buffer} - Buffer con el contenido del archivo
 */
async function downloadMedia(mediaId) {
    try {
        // Primero obtenemos la URL del archivo
        const urlResponse = await axios.get(`${BASE_URL}/${mediaId}`, {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            },
        });

        const mediaUrl = urlResponse.data.url;

        // Luego descargamos el archivo
        const fileResponse = await axios.get(mediaUrl, {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            },
            responseType: "arraybuffer",
        });

        console.log(`✅ Audio descargado (${mediaId})`);
        return {
            buffer: Buffer.from(fileResponse.data),
            mimeType: urlResponse.data.mime_type,
        };
    } catch (error) {
        console.error(`❌ Error descargando media ${mediaId}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Marca un mensaje como leído
 * @param {string} messageId - ID del mensaje
 */
async function markAsRead(messageId) {
    try {
        await axios.post(
            `${BASE_URL}/${process.env.WHATSAPP_PHONE_ID}/messages`,
            {
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error) {
        // No es crítico si falla, solo logueamos
        console.warn(`⚠️ No se pudo marcar como leído:`, error.message);
    }
}

module.exports = { sendMessage, downloadMedia, markAsRead };
