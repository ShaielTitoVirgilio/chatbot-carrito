// =============================================
// EDITOR DE MENU  (/api/editar/*)
// =============================================
// Lo usa la pagina /editar: lista completa de productos con precio y stock, y
// precio de las opciones (extras, salsas, sabores).
//
// Va montado bajo /api, que ya exige basicAuth (los mismos usuario y clave
// que /panel): no hace falta proteger cada ruta, y una ruta nueva queda
// protegida sola.

const express = require("express");
const supabase = require("./db");
const catalog = require("./catalog");
const { parseCambios } = require("./admin-validate");

const router = express.Router();

const asyncRoute = fn => (req, res) =>
    Promise.resolve(fn(req, res)).catch(e => {
        console.error(`❌ /api/editar${req.path}:`, e.message);
        if (!res.headersSent) res.status(500).json({ error: "error_interno" });
    });

function throwIf(error, que) {
    if (error) throw new Error(`No pude leer ${que}: ${error.message}`);
}

// ─────────────────────────────────────────────
// GET /menu — todo lo editable, incluidos los productos sin stock
// ─────────────────────────────────────────────
router.get("/menu", asyncRoute(async (req, res) => {
    const [menu, groups, items, catOpts, itemOpts] = await Promise.all([
        supabase.from("menu").select("id, slug, categoria, nombre, descripcion, precio, disponible, orden, thumb_url").order("orden"),
        supabase.from("option_groups").select("id, slug, nombre, activo, orden").order("orden"),
        supabase.from("option_items").select("id, group_id, slug, nombre, precio_extra, orden").order("orden"),
        supabase.from("category_options").select("categoria, group_id, enabled"),
        supabase.from("menu_item_options").select("menu_id, group_id, enabled"),
    ]);
    throwIf(menu.error, "el menu");
    throwIf(groups.error, "los grupos de opciones");
    throwIf(items.error, "las opciones");
    throwIf(catOpts.error, "category_options");
    throwIf(itemOpts.error, "menu_item_options");

    // RLS no da error: devuelve cero filas. Mejor avisar que mostrar un
    // editor vacio que parece que "no hay nada para editar".
    if (!menu.data.length) {
        throw new Error("el menu vino vacio (revisar SUPABASE_SERVICE_ROLE_KEY y RLS)");
    }

    const nombreProducto = new Map(menu.data.map(p => [p.id, p.nombre]));

    // "Se usa en": para distinguir grupos que se llaman igual (hay varios
    // "Sabor", uno por bebida).
    const usadoEn = new Map();
    const agregar = (groupId, texto) => {
        if (!usadoEn.has(groupId)) usadoEn.set(groupId, []);
        usadoEn.get(groupId).push(texto);
    };
    for (const co of catOpts.data) {
        if (co.enabled !== false) agregar(co.group_id, String(co.categoria).toLowerCase());
    }
    for (const mo of itemOpts.data) {
        if (mo.enabled !== false && nombreProducto.has(mo.menu_id)) {
            agregar(mo.group_id, nombreProducto.get(mo.menu_id));
        }
    }

    const grupos = groups.data
        .map(g => ({
            id: g.id,
            slug: g.slug,
            nombre: g.nombre,
            activo: g.activo !== false,
            usado_en: usadoEn.get(g.id) || [],
            opciones: items.data
                .filter(o => o.group_id === g.id)
                .map(o => ({ id: o.id, nombre: o.nombre, precio_extra: Number(o.precio_extra || 0) })),
        }))
        .filter(g => g.opciones.length);

    res.set("Cache-Control", "no-store");
    res.json({
        productos: menu.data.map(p => ({
            id: p.id,
            slug: p.slug,
            categoria: String(p.categoria || "").toLowerCase(),
            nombre: p.nombre,
            descripcion: p.descripcion || "",
            precio: Number(p.precio || 0),
            sin_stock: p.disponible === false,
            orden: Number(p.orden || 0),
            thumb_url: p.thumb_url || null,
        })),
        grupos,
    });
}));

// ─────────────────────────────────────────────
// POST /guardar — aplica los cambios y refresca el catalogo
// ─────────────────────────────────────────────
// Body: { productos: [{ id, precio?, sin_stock? }], opciones: [{ id, precio_extra }] }
router.post("/guardar", asyncRoute(async (req, res) => {
    const { productos, opciones, errores } = parseCambios(req.body);
    if (errores.length) return res.status(422).json({ error: "datos_invalidos", errores });
    if (!productos.length && !opciones.length) return res.json({ ok: true, guardados: 0, fallidos: [] });

    // Un UPDATE bloqueado por RLS no tira error: afecta cero filas. Por eso se
    // pide `select` y se cuenta lo que realmente cambio.
    const tareas = [
        ...productos.map(async ({ id, ...campos }) => {
            const { data, error } = await supabase.from("menu").update(campos).eq("id", id).select("id");
            return { tipo: "producto", id, ok: !error && data && data.length === 1, error: error && error.message };
        }),
        ...opciones.map(async ({ id, precio_extra }) => {
            const { data, error } = await supabase.from("option_items").update({ precio_extra }).eq("id", id).select("id");
            return { tipo: "opcion", id, ok: !error && data && data.length === 1, error: error && error.message };
        }),
    ];
    const resultados = await Promise.all(tareas);
    const fallidos = resultados.filter(r => !r.ok).map(({ tipo, id, error }) => ({ tipo, id, error: error || "no_encontrado" }));

    // El catalogo vive 5 minutos en memoria: sin esto el cambio tardaria en
    // verse en la web de pedidos.
    catalog.invalidate();

    console.log(`✏️  Editor de menu: ${resultados.length - fallidos.length} cambios guardados` +
        (fallidos.length ? `, ${fallidos.length} fallidos` : ""));

    res.status(fallidos.length ? 207 : 200).json({
        ok: fallidos.length === 0,
        guardados: resultados.length - fallidos.length,
        fallidos,
    });
}));

module.exports = router;
