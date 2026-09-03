// =============================================
// PRECIOS Y HORARIO — logica pura, sin Supabase
// =============================================
// Separado de catalog.js a proposito: aca no hay I/O ni credenciales, asi que
// se testea entero con `npm test` sin base de datos ni .env.
//
// Regla dura: el precio NUNCA viene del cliente. El navegador manda slugs y
// este modulo decide cuanto sale.

// ─────────────────────────────────────────────
// PRECIOS — el unico lugar donde se calcula plata
// ─────────────────────────────────────────────

function findProduct(catalog, slug) {
    if (!slug) return null;
    const s = String(slug).toLowerCase();
    return catalog.productos.find(p => p.slug === s) || null;
}

const MAX_CANTIDAD = 20;

function clampCantidad(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v) || v < 1) return 1;
    return Math.min(v, MAX_CANTIDAD);
}

// Valida una linea del carrito y le pone precio.
// Devuelve { ok, line, errores[], avisos[] }. Nunca tira.
//
// Filosofia de errores: lo que hace inviable la linea (producto inexistente,
// falta una opcion obligatoria) es ERROR y frena el pedido. Lo que es un
// detalle corregible (una salsa que no existe, verduras en un pancho) es AVISO:
// se descarta esa opcion y la linea sigue viva. Fallar el pedido entero porque
// alguien pidio rucula seria peor experiencia que sacarle la rucula.
function priceLine(catalog, rawLine) {
    const errores = [];
    const avisos = [];

    const producto = findProduct(catalog, rawLine?.producto_slug);
    if (!producto) {
        return {
            ok: false,
            errores: [{ codigo: "producto_no_encontrado", producto_slug: rawLine?.producto_slug || null }],
            avisos,
        };
    }

    const cantidad = clampCantidad(rawLine.cantidad);
    const opcionesEntrada = rawLine.opciones || {};
    const opcionesElegidas = {};
    let extraUnitario = 0;

    for (const grupo of producto.grupos) {
        const pedidas = normalizeSlugs(opcionesEntrada[grupo.slug]);
        const validas = [];

        for (const slug of pedidas) {
            const opcion = grupo.opciones.find(o => o.slug === slug);
            if (!opcion) {
                avisos.push({
                    codigo: "opcion_invalida",
                    grupo: grupo.slug,
                    opcion: slug,
                    disponibles: grupo.opciones.map(o => o.slug),
                });
                continue;
            }
            if (validas.some(v => v.slug === opcion.slug)) continue;   // duplicado
            validas.push(opcion);
        }

        if (grupo.max && validas.length > grupo.max) {
            avisos.push({ codigo: "supera_maximo", grupo: grupo.slug, max: grupo.max });
            validas.length = grupo.max;
        }

        const minimo = grupo.requerido ? Math.max(grupo.min || 0, 1) : (grupo.min || 0);
        if (validas.length < minimo) {
            errores.push({
                codigo: "falta_opcion",
                grupo: grupo.slug,
                nombre: grupo.nombre,
                min: minimo,
                disponibles: grupo.opciones.map(o => ({ slug: o.slug, nombre: o.nombre })),
            });
        }

        if (validas.length) {
            opcionesElegidas[grupo.slug] = validas.map(o => o.slug);
            for (const o of validas) extraUnitario += o.precio_extra;
        }
    }

    // Grupos que el cliente mando pero que este producto no acepta.
    // Ej: verduras en un pancho. Se descartan con aviso, no rompen el pedido.
    for (const grupoSlug of Object.keys(opcionesEntrada)) {
        if (!producto.grupos.some(g => g.slug === grupoSlug)) {
            if (normalizeSlugs(opcionesEntrada[grupoSlug]).length) {
                avisos.push({ codigo: "grupo_no_aplica", grupo: grupoSlug, producto: producto.slug });
            }
        }
    }

    const precioUnitario = producto.precio + extraUnitario;

    return {
        ok: errores.length === 0,
        errores,
        avisos,
        line: {
            producto_slug: producto.slug,
            nombre: producto.nombre,
            categoria: producto.categoria,
            cantidad,
            opciones: opcionesElegidas,
            nota: cleanNota(rawLine.nota),
            precio_unitario: precioUnitario,
            precio_linea: precioUnitario * cantidad,
        },
    };
}

function normalizeSlugs(v) {
    if (!v) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map(x => String(x || "").trim().toLowerCase()).filter(Boolean);
}

function cleanNota(nota) {
    if (!nota) return null;
    const limpia = String(nota).replace(/\s+/g, " ").trim().slice(0, 140);
    return limpia || null;
}

// Precia el carrito entero. Es lo que corre antes de guardar el pedido.
function priceCart(catalog, rawLines) {
    const lines = [];
    const errores = [];
    const avisos = [];

    const entrada = Array.isArray(rawLines) ? rawLines : [];
    if (!entrada.length) {
        return { ok: false, lines: [], items_total: 0, errores: [{ codigo: "carrito_vacio" }], avisos };
    }

    entrada.forEach((raw, i) => {
        const r = priceLine(catalog, raw);
        r.avisos.forEach(a => avisos.push({ ...a, index: i }));
        r.errores.forEach(e => errores.push({ ...e, index: i }));
        if (r.line) lines.push(r.line);
    });

    const items_total = lines.reduce((acc, l) => acc + l.precio_linea, 0);
    return { ok: errores.length === 0, lines, items_total, errores, avisos };
}

// ─────────────────────────────────────────────
// HORARIO
// ─────────────────────────────────────────────
// Reemplaza a isOpen() de bot.js:154, que tenia dos problemas: el horario
// estaba hardcodeado en 18:35 (se publica 18:30) y entre las 18:00 y las 18:35
// respondia "ya cerramos por esta noche" cuando en realidad faltaba un rato
// para abrir.

function parseHHMM(str, fallback) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || ""));
    if (!m) return fallback;
    return Number(m[1]) * 60 + Number(m[2]);
}

function minutosLocales(tz) {
    const fmt = new Intl.DateTimeFormat("es-UY", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const [h, m] = fmt.format(new Date()).split(":").map(Number);
    return (h % 24) * 60 + m;
}

function getOpenState(config) {
    const horario = (config && config.horario) || {};
    const tz = horario.tz || "America/Montevideo";
    const abre = parseHHMM(horario.abre, 18 * 60 + 30);
    const cierra = parseHHMM(horario.cierra, 2 * 60);
    const ahora = minutosLocales(tz);

    // El horario cruza medianoche (18:30 -> 02:00).
    const cruzaMedianoche = cierra <= abre;
    let abierto = cruzaMedianoche
        ? (ahora >= abre || ahora < cierra)
        : (ahora >= abre && ahora < cierra);

    if (horario.cerrado_excepcional) abierto = false;

    // Minutos hasta la proxima apertura (si ya paso hoy, es manana).
    const faltan = ahora <= abre ? abre - ahora : (24 * 60 - ahora) + abre;

    return {
        abierto,
        abre: horario.abre || "18:30",
        cierra: horario.cierra || "02:00",
        abre_en_minutos: abierto ? 0 : faltan,
        cerrado_excepcional: !!horario.cerrado_excepcional,
    };
}

module.exports = {
    findProduct, priceLine, priceCart, clampCantidad,
    getOpenState, MAX_CANTIDAD,
};
