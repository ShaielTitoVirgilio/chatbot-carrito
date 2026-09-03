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

// Postgres 42P01 = "relation does not exist".
const TABLA_INEXISTENTE = "42P01";

// Leer las opciones NO es opcional: si fallan, un producto que exige verduras
// se mostraria sin ellas y el cliente podria mandar una "Completa" a medias.
// Es peor tomar un pedido mal que no tomarlo, asi que el error se propaga y
// /api/web/catalog responde 503 en vez de servir un menu incompleto.
//
// La unica excepcion es que la tabla no exista todavia (proyecto sin migrar):
// ahi si se degrada, porque es un entorno a medio configurar, no produccion.
async function selectOpciones(table, columns) {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) {
        if (error.code === TABLA_INEXISTENTE) {
            console.warn(`⚠️ catalog: ${table} no existe todavía — falta correr las migraciones`);
            return [];
        }
        throw new Error(`No pude leer ${table}: ${error.message} (${error.code || "sin código"})`);
    }
    return data || [];
}

async function loadCatalog() {
    const [menuRes, groups, items, catOpts, itemOpts, configRows] = await Promise.all([
        supabase.from("menu").select("*").eq("disponible", true).order("orden"),
        selectOpciones("option_groups", "*"),
        selectOpciones("option_items", "*"),
        selectOpciones("category_options", "*"),
        selectOpciones("menu_item_options", "*"),
        selectOpciones("config", "*"),
    ]);

    if (menuRes.error) throw new Error(`No pude leer el menu: ${menuRes.error.message}`);

    const config = {};
    for (const row of configRows) config[row.key] = row.value;

    // Chequeo de sanidad. RLS no devuelve error cuando bloquea: devuelve CERO
    // filas. Sin esto, una mala configuracion de permisos servia un menu sin
    // horario ni opciones obligatorias, en silencio, y el cliente podia mandar
    // una "Completa" sin verduras.
    if (!config.horario) {
        throw new Error(
            "No pude leer la config del local (0 filas). " +
            "Revisá SUPABASE_SERVICE_ROLE_KEY y las policies de RLS."
        );
    }

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
