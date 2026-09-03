// =============================================
// CORS + rate limiting para /api/web
// =============================================
// Escritos a mano en vez de sumar `cors` y `express-rate-limit`: el proyecto
// tiene 6 dependencias y el volumen es de decenas de pedidos por dia. Si
// alguna vez Railway corre mas de una replica, el limiter hay que moverlo a
// la base (hoy vive en memoria, igual que las sesiones del bot).

const ALLOWED_ORIGINS = [
    /^https?:\/\/localhost:\d+$/,
    /^https?:\/\/127\.0\.0\.1:\d+$/,
    /\.vercel\.app$/,
    /\.up\.railway\.app$/,
    /\.netlify\.app$/,
];

// Dominios propios que se agreguen por env (coma-separados), para no tener
// que tocar codigo cuando se compre el dominio.
for (const extra of String(process.env.WEB_ORIGINS || "").split(",")) {
    const clean = extra.trim();
    if (clean) ALLOWED_ORIGINS.push(clean);
}

function originAllowed(origin) {
    if (!origin) return false;
    return ALLOWED_ORIGINS.some(rule =>
        rule instanceof RegExp ? rule.test(origin) : rule === origin);
}

// Allowlist, no "*": permite limitar por origen y evita que embeban la API.
function cors(req, res, next) {
    const origin = req.headers.origin;
    if (originAllowed(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
}

// ── Rate limiting por IP, ventana deslizante simple ──
const buckets = new Map();

function cleanup(now) {
    for (const [key, hits] of buckets) {
        const vivos = hits.filter(t => t > now - 3600_000);
        if (vivos.length) buckets.set(key, vivos);
        else buckets.delete(key);
    }
}
setInterval(() => cleanup(Date.now()), 10 * 60_000).unref();

function rateLimit({ windowMs, max, key = "" }) {
    return (req, res, next) => {
        // Requiere app.set('trust proxy', 1): detras del proxy de Railway,
        // sin eso todas las requests comparten IP y el limite es inutil.
        const id = `${key}:${req.ip}`;
        const now = Date.now();
        const hits = (buckets.get(id) || []).filter(t => t > now - windowMs);

        if (hits.length >= max) {
            const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
            res.set("Retry-After", String(retryAfter));
            return res.status(429).json({ error: "rate_limit", retry_after: retryAfter });
        }

        hits.push(now);
        buckets.set(id, hits);
        next();
    };
}

module.exports = { cors, rateLimit, originAllowed, ALLOWED_ORIGINS };
