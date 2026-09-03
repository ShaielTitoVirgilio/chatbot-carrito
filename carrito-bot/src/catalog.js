// =============================================
// CATALOGO — fuente unica de productos, opciones y precios
// =============================================
// Lo consumen el endpoint /api/web/catalog (para pintar el carrito) y el
// calculo de precios del pedido. Que sea el MISMO modulo es a proposito: si
// una opcion no es legal para un producto, no la ofrece la UI y tampoco la
// acepta el server.
//
// Regla dura: el precio NUNCA viene del cliente. El navegador manda slugs.

const supabase = require("./db");
const pricing = require("./pricing");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;
let cacheAt = 0;

function invalidate() {
    cache = null;
    cacheAt = 0;
}

// Las tablas de opciones son nuevas (migracion 003). Si todavia no existen,
// el catalogo funciona igual y devuelve productos sin opciones, en vez de
// tirar abajo la web entera.
async function safeSelect(table, columns) {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) {
        console.warn(`⚠️ catalog: no pude leer ${table} (${error.message}) — sigo sin eso`);
        return [];
    }
    return data || [];
}

async function loadCatalog() {
    const [menuRes, groups, items, catOpts, itemOpts, configRows] = await Promise.all([
        supabase.from("menu").select("*").eq("disponible", true).order("orden"),
        safeSelect("option_groups", "*"),
        safeSelect("option_items", "*"),
        safeSelect("category_options", "*"),
        safeSelect("menu_item_options", "*"),
        safeSelect("config", "*"),
    ]);

    if (menuRes.error) throw new Error(`No pude leer el menu: ${menuRes.error.message}`);

    const config = {};
    for (const row of configRows) config[row.key] = row.value;

    const groupById = new Map(groups.filter(g => g.activo !== false).map(g => [g.id, g]));

    const itemsByGroup = new Map();
    for (const it of items) {
        if (it.disponible === false) continue;
        if (!itemsByGroup.has(it.group_id)) itemsByGroup.set(it.group_id, []);
        itemsByGroup.get(it.group_id).push(it);
    }
    for (const arr of itemsByGroup.values()) arr.sort((a, b) => (a.orden || 0) - (b.orden || 0));

    // category_options indexado por categoria en minuscula
    const byCategoria = new Map();
    for (const co of catOpts) {
        const key = String(co.categoria || "").toLowerCase();
        if (!byCategoria.has(key)) byCategoria.set(key, []);
        byCategoria.get(key).push(co);
    }

    const byMenuId = new Map();
    for (const mo of itemOpts) {
        if (!byMenuId.has(mo.menu_id)) byMenuId.set(mo.menu_id, []);
        byMenuId.get(mo.menu_id).push(mo);
    }

    const productos = (menuRes.data || []).map(p =>
        buildProducto(p, { groupById, itemsByGroup, byCategoria, byMenuId }));

    // El orden de cada categoria sale del producto mas prioritario que tenga.
    const catOrden = new Map();
    for (const p of productos) {
        const prev = catOrden.get(p.categoria);
        if (prev === undefined || p.orden < prev) catOrden.set(p.categoria, p.orden);
    }
    const categorias = [...catOrden.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([slug, orden]) => ({ slug, orden }));

    return { version: Date.now(), categorias, productos, config };
}

// Resuelve los grupos efectivos de un producto: default de la categoria,
// pisado por el override del producto. enabled=false elimina el grupo,
// los campos null heredan.
function buildProducto(p, ctx) {
    const { groupById, itemsByGroup, byCategoria, byMenuId } = ctx;
    const categoria = String(p.categoria || "").toLowerCase();

    const efectivos = new Map();   // group_id -> reglas
    for (const co of byCategoria.get(categoria) || []) {
        efectivos.set(co.group_id, { ...co });
    }
    for (const mo of byMenuId.get(p.id) || []) {
        const base = efectivos.get(mo.group_id) || {};
        efectivos.set(mo.group_id, { ...base, ...stripNulls(mo) });
    }

    const grupos = [];
    for (const [groupId, reglas] of efectivos) {
        if (reglas.enabled === false) continue;
        const g = groupById.get(groupId);
        if (!g) continue;
        const opciones = itemsByGroup.get(groupId) || [];
        if (!opciones.length) continue;

        grupos.push({
            slug: g.slug,
            nombre: g.nombre,
            tipo: g.tipo,
            min: pick(reglas.min_select, g.min_select, 0),
            max: pick(reglas.max_select, g.max_select, null),
            requerido: pick(reglas.requerido, g.requerido, false),
            orden: pick(reglas.orden, g.orden, 0),
            opciones: opciones.map(o => ({
                slug: o.slug,
                nombre: o.nombre,
                precio_extra: Number(o.precio_extra || 0),
                emoji: o.emoji || null,
            })),
        });
    }
    grupos.sort((a, b) => a.orden - b.orden);

    return {
        id: p.id,
        slug: p.slug || `item-${p.id}`,
        categoria,
        nombre: p.nombre,
        descripcion: p.descripcion || "",
        precio: Number(p.precio || 0),
        destacado: !!p.destacado,
        // Dos imagenes: la chica va en la tarjeta del menu, la grande en el
        // detalle. El frontend resuelve el fallback entre ellas y la categoria.
        image_url: p.image_url || null,
        thumb_url: p.thumb_url || null,
        orden: Number(p.orden || 0),
        grupos,
    };
}

function stripNulls(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
    return out;
}

function pick(...vals) {
    for (const v of vals) if (v !== null && v !== undefined) return v;
    return null;
}

async function getCatalog({ force = false } = {}) {
    const now = Date.now();
    if (!force && cache && now - cacheAt < CACHE_TTL_MS) return cache;
    try {
        cache = await loadCatalog();
        cacheAt = now;
        return cache;
    } catch (e) {
        if (cache) {
            console.warn(`⚠️ catalog: fallo la recarga (${e.message}) — sirvo cache vieja`);
            return cache;
        }
        throw e;
    }
}

module.exports = {
    getCatalog, invalidate, CACHE_TTL_MS,
    // Re-exportados desde pricing.js para que quien use el catalogo tenga
    // todo en un solo require.
    ...pricing,
};
