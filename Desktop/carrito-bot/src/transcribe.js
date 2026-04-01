// =============================================
// MÓDULO DE TRANSCRIPCIÓN DE AUDIO
// Usa OpenAI Whisper para convertir voz a texto
// =============================================

const axios = require("axios");
const FormData = require("form-data");

/**
 * Transcribe un buffer de audio usando OpenAI Whisper
 * @param {Buffer} audioBuffer - Buffer con el audio
 * @param {string} mimeType - Tipo MIME del audio (ej: audio/ogg; codecs=opus)
 * @returns {string} - Texto transcripto
 */
async function transcribeAudio(audioBuffer, mimeType) {
    try {
        // Determinar extensión según el mime type de WhatsApp
        // WhatsApp envía audios en formato OGG/Opus
        let extension = "ogg";
        if (mimeType?.includes("mp4")) extension = "mp4";
        if (mimeType?.includes("mpeg")) extension = "mp3";
        if (mimeType?.includes("wav")) extension = "wav";
        if (mimeType?.includes("webm")) extension = "webm";

        const form = new FormData();
        form.append("file", audioBuffer, {
            filename: `audio.${extension}`,
            contentType: mimeType || "audio/ogg",
        });
        form.append("model", "whisper-large-v3-turbo");
        form.append("language", "es"); // Español
        form.append("response_format", "text");

        const response = await axios.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            form,
            {
                headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    ...form.getHeaders(),
                },
                maxBodyLength: Infinity,
            }
        );

        const transcription = response.data.trim();
        console.log(`🎤 Audio transcripto: "${transcription}"`);
        return transcription;
    } catch (error) {
        console.error("❌ Error transcribiendo audio:", error.response?.data || error.message);
        // Si falla la transcripción, devolvemos null para que el bot pida que escriban
        return null;
    }
}

module.exports = { transcribeAudio };
