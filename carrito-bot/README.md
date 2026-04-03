# 🛒 Carrito del Paseo — WhatsApp Bot

Bot de WhatsApp para tomar pedidos automáticamente, responder preguntas frecuentes y notificar al dueño cuando se confirma un pedido.

---

## 📁 Estructura

```
carrito-bot/
├── src/
│   ├── index.js        ← Servidor Express + webhook handler
│   ├── bot.js          ← Lógica de conversación con Claude AI
│   ├── whatsapp.js     ← Envío/descarga de mensajes vía Meta API
│   ├── transcribe.js   ← Transcripción de audios con OpenAI Whisper
│   └── menu.js         ← Menú, precios e info del local
├── .env.example        ← Plantilla de variables de entorno
├── .gitignore
└── package.json
```

---

## ⚙️ Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de entorno
cp .env.example .env
# Editá .env con tus claves reales

# 3. Correr en desarrollo
npm run dev

# 4. Correr en producción
npm start
```

---

## 🔑 Variables de entorno necesarias

| Variable | Dónde obtenerla |
|---|---|
| `WHATSAPP_TOKEN` | Meta Developer > tu app > WhatsApp > Configuración API |
| `WHATSAPP_PHONE_ID` | Meta Developer > tu app > WhatsApp > Configuración API |
| `WEBHOOK_VERIFY_TOKEN` | Lo inventás vos (cualquier string secreto) |
| `GROQ_API_KEY` | console.groq.com |
| `OPENAI_API_KEY` | platform.openai.com |
| `OWNER_PHONE` | `59899932502` (número del dueño, código país + número) |

---

## 🚀 Deploy en Railway

1. Crear cuenta en [railway.app](https://railway.app)
2. New Project > Deploy from GitHub repo
3. Agregar las variables de entorno en Railway > Variables
4. El dominio generado será tu webhook URL: `https://xxx.railway.app/webhook`

---

## 📡 Configurar webhook en Meta

1. Ir a [developers.facebook.com](https://developers.facebook.com)
2. Tu App > WhatsApp > Configuración
3. Webhook URL: `https://TU-DOMINIO/webhook`
4. Verify Token: el mismo que pusiste en `WEBHOOK_VERIFY_TOKEN`
5. Suscribirse a: `messages`

---

## 🧪 Probar localmente con ngrok

```bash
# Instalar ngrok: https://ngrok.com
ngrok http 3000
# Usar la URL https://xxx.ngrok.io/webhook en Meta
```
