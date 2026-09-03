// =============================================
// API PUBLICA DE LA WEB DE PEDIDOS  (/api/web/*)
// =============================================
// La consume la pagina /pedir. Es publica (sin basicAuth), asi que todo lo que
// llega se valida: los precios se recalculan siempre en el server y el cliente
// solo manda slugs.

const express = require("express");
const crypto = require("crypto");
const supabase = require("../db");
const catalog = require("../catalog");
const { rateLimit } = require("./middleware");

const router = express.Router();

const asyncRoute = fn => (req, res) =>
    Promise.resolve(fn(req, res)).catch(e => {
        console.error(`❌ /api/web${req.path}:`, e.message);
        if (res.headersSent) return;
        // Si no se pudo armar el catalogo, la web no puede tomar pedidos
        // confiables: se responde 503 para que muestre "no disponible" en vez
        // de un menu sin las opciones obligatorias.
        const sinCatalogo = /No pude leer|No pude leer el menu/.test(e.message);
        res.status(sinCatalogo ? 503 : 500)
           .json({ error: sinCatalogo ? "catalogo_no_disponible" : "error_interno" });
    });

// ─────────────────────────────────────────────
// GET /catalog — todo lo que necesita la web para pintarse
// ─────────────────────────────────────────────
router.get("/catalog", asyncRoute(async (req, res) => {
    const data = await catalog.getCatalog();
    const payload = {
        version: data.version,
        categorias: data.categorias,
        productos: data.productos,
        config: {
            local: data.config.local || null,
            delivery: data.config.delivery || null,
            pagos: data.config.pagos || null,
        },
        estado: catalog.getOpenState(data.config),
    };

    // ETag para que el celular no vuelva a bajar 30 productos en cada visita.
    const etag = `W/"${data.version}"`;
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=60");
    res.json(payload);
}));

// ─────────────────────────────────────────────
// GET /status — abierto/cerrado. Barato, se pollea.
// ─────────────────────────────────────────────
router.get("/status", asyncRoute(async (req, res) => {
    const data = await catalog.getCatalog();
    const web = data.config.web || {};
    res.set("Cache-Control", "no-store");
    res.json({
        ...catalog.getOpenState(data.config),
        pedidos_habilitados: web.pedidos_habilitados !== false,
    });
}));

// ─────────────────────────────────────────────
// POST /cart/price — re-precia el carrito
// ─────────────────────────────────────────────
// La UI calcula un precio optimista para que tocar "+" sea instantaneo; esto
// es la verdad. Se llama al abrir el checkout.
router.post("/cart/price", rateLimit({ windowMs: 60_000, max: 60, key: "price" }),
    asyncRoute(async (req, res) => {
        const data = await catalog.getCatalog();
        const r = catalog.priceCart(data, req.body?.lines);
        const delivery = data.config.delivery || {};
        res.json({
            ok: r.ok,
            lines: r.lines,
            items_total: r.items_total,
            delivery_fee_estimado: Number(delivery.costo_sugerido || 0),
            leyenda_envio: delivery.leyenda || "El envío te lo confirma el local",
            errores: r.errores,
            avisos: r.avisos,
        });
    }));

// ─────────────────────────────────────────────
// POST /orders — crea el pedido
// ─────────────────────────────────────────────
const TIPOS = new Set(["retiro", "delivery"]);

function limpiarTexto(v, max) {
    if (!v) return null;
    const s = String(v).replace(/\s+/g, " ").trim().slice(0, max);
    return s || null;
}

function validarCliente(body) {
    const errores = [];
    const tipo = String(body.tipo || "").toLowerCase();
    if (!TIPOS.has(tipo)) errores.push({ campo: "tipo", codigo: "invalido" });

    const nombre = limpiarTexto(body.cliente?.nombre, 60);
    if (!nombre) errores.push({ campo: "nombre", codigo: "requerido" });

    // Telefono obligatorio SIEMPRE: es el unico canal para avisarle al cliente,
    // porque la conversacion se cierra por WhatsApp.
    const telefono = limpiarTexto(body.cliente?.telefono, 25);
    if (!telefono) errores.push({ campo: "telefono", codigo: "requerido" });

    let direccion = null, referencia = null;
    if (tipo === "delivery") {
        direccion = limpiarTexto(body.cliente?.direccion, 160);
        if (!direccion) errores.push({ campo: "direccion", codigo: "requerido" });
        referencia = limpiarTexto(body.cliente?.referencia, 120);
    }
    return { errores, tipo, nombre, telefono, direccion, referencia };
}

router.post("/orders", rateLimit({ windowMs: 10 * 60_000, max: 5, key: "orders" }),
    asyncRoute(async (req, res) => {
        const body = req.body || {};
        const data = await catalog.getCatalog();

        // Idempotencia: si el cliente toca "Enviar" dos veces (o se le corta la
        // conexion y reintenta), devolvemos el pedido que ya existe.
        const clientOrderId = body.client_order_id;
        if (clientOrderId) {
            const { data: previo } = await supabase
                .from("orders").select("*")
                .eq("client_order_id", clientOrderId).maybeSingle();
            if (previo) return res.status(200).json(serializarPedido(previo));
        }

        const estado = catalog.getOpenState(data.config);
        const web = data.config.web || {};
        if (web.pedidos_habilitados === false) {
            return res.status(503).json({ error: "pedidos_deshabilitados" });
        }
        if (!estado.abierto) {
            return res.status(409).json({ error: "cerrado", abre_en_minutos: estado.abre_en_minutos });
        }

        const cliente = validarCliente(body);
        const precio = catalog.priceCart(data, body.cart?.lines);

        if (cliente.errores.length || !precio.ok) {
            return res.status(422).json({
                error: "datos_invalidos",
                campos: cliente.errores,
                carrito: precio.errores,
            });
        }

        // Medio de pago: se valida contra config, no contra lo que diga el front.
        const pagosOk = (data.config.pagos || {})[cliente.tipo] || ["efectivo"];
        const pago = pagosOk.includes(body.pago) ? body.pago : pagosOk[0];

        const { data: numero, error: rpcError } = await supabase.rpc("next_order_number");
        if (rpcError) {
            console.error("❌ next_order_number:", rpcError.message);
            return res.status(500).json({ error: "no_pude_numerar" });
        }

        const publicToken = crypto.randomBytes(24).toString("base64url");
        const deliveryFee = 0;   // lo fija el empleado al confirmar

        const fila = {
            order_number: numero,
            channel: "web",
            public_token: publicToken,
            client_order_id: clientOrderId || null,
            customer_name: cliente.nombre,
            customer_phone: cliente.telefono,
            contact_phone: cliente.telefono,
            type: cliente.tipo,
            address: cliente.direccion,
            address_details: cliente.referencia,
            items: precio.lines,
            items_total: precio.items_total,
            subtotal: precio.items_total,
            delivery_fee: deliveryFee,
            total: precio.items_total + deliveryFee,
            payment_method: pago,
            pays_with: Number(body.paga_con) > 0 ? Number(body.paga_con) : null,
            customer_note: limpiarTexto(body.nota, 300),
            status: "pending",
        };

        const { data: creado, error } = await supabase
            .from("orders").insert(fila).select().single();
        if (error) {
            console.error("❌ insert order:", error.message);
            return res.status(500).json({ error: "no_pude_guardar" });
        }

        console.log(`🌐 Pedido web ${numero} — ${cliente.nombre} (${cliente.tipo}) $${fila.total}`);
        res.status(201).json(serializarPedido(creado));
    }));

// ─────────────────────────────────────────────
// GET /orders/:token — pantalla de "pedido enviado"
// ─────────────────────────────────────────────
router.get("/orders/:token", asyncRoute(async (req, res) => {
    const { data: order } = await supabase
        .from("orders").select("*")
        .eq("public_token", req.params.token).maybeSingle();
    // 404 tambien si el token no existe: no distinguimos "no existe" de
    // "no autorizado" para que no se puedan enumerar pedidos.
    if (!order) return res.status(404).json({ error: "no_encontrado" });
    res.set("Cache-Control", "no-store");
    res.json(serializarPedido(order));
}));

// Solo lo que el cliente necesita ver. Nunca la fila cruda.
function serializarPedido(o) {
    return {
        order_number: o.order_number,
        public_token: o.public_token,
        estado: o.status,
        tipo: o.type,
        items: o.items || [],
        items_total: Number(o.items_total ?? o.subtotal ?? 0),
        delivery_fee: Number(o.delivery_fee || 0),
        total: Number(o.total || 0),
        eta_minutes: o.eta_minutes || null,
        rejected_reason: o.rejected_reason || null,
        created_at: o.created_at,
    };
}

module.exports = router;
