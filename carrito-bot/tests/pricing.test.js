// node --test tests/
// Tests de la logica pura del catalogo: no tocan Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { priceLine, priceCart, clampCantidad, getOpenState } = require("../src/pricing");

// ── Catalogo de prueba: refleja las reglas reales del local ──
const VERDURAS = ["lechuga","tomate","cebolla","choclo","arveja","aceituna","morrones","hongos","ajies","pickles"]
    .map((slug, i) => ({ slug, nombre: slug, precio_extra: 0, emoji: null, orden: i }));
const SALSAS = ["mayonesa","ketchup","mostaza"].map((slug,i)=>({slug,nombre:slug,precio_extra:0,orden:i}));
const EXTRAS = [
    { slug: "panceta", nombre: "Panceta extra", precio_extra: 60 },
    { slug: "huevo",   nombre: "Huevo frito",   precio_extra: 40 },
    { slug: "cheddar", nombre: "Queso cheddar", precio_extra: 50 },
];

const grupo = (slug, nombre, opciones, extra = {}) => ({
    slug, nombre, tipo: "multi", min: 0, max: null, requerido: false, orden: 0, opciones, ...extra,
});

const CATALOG = {
    productos: [
        {   // lleva verduras OBLIGATORIAS, no lleva extras (es "Completa")
            id: 1, slug: "hamburguesa-completa", categoria: "hamburguesas",
            nombre: "Hamburguesa Completa", precio: 175, orden: 3,
            grupos: [
                grupo("verduras", "Verduras", VERDURAS, { min: 1, max: 10, requerido: true, orden: 1 }),
                grupo("salsas", "Salsas", SALSAS, { max: 3, orden: 3 }),
            ],
        },
        {   // no dice "Completa": SI lleva extras, no lleva verduras
            id: 2, slug: "hamburguesa-mixta", categoria: "hamburguesas",
            nombre: "Hamburguesa Mixta", precio: 139, orden: 1,
            grupos: [
                grupo("extras", "Extras", EXTRAS, { max: 3, orden: 2 }),
                grupo("salsas", "Salsas", SALSAS, { max: 3, orden: 3 }),
            ],
        },
        {   // los panchos NO llevan verduras ni extras, solo salsas
            id: 3, slug: "pancho-con-salsas", categoria: "panchos",
            nombre: "Pancho con Salsas", precio: 95, orden: 1,
            grupos: [grupo("salsas", "Salsas", SALSAS, { max: 3, orden: 3 })],
        },
        {   // las bebidas no llevan nada
            id: 4, slug: "refresco-cola-600ml", categoria: "bebidas",
            nombre: "Refresco Cola 600ml", precio: 70, orden: 1, grupos: [],
        },
    ],
};

// ── Reglas de personalizacion ──

test("la Completa exige verduras y no ofrece extras", () => {
    const p = CATALOG.productos.find(x => x.slug === "hamburguesa-completa");
    assert.ok(p.grupos.some(g => g.slug === "verduras" && g.requerido));
    assert.ok(!p.grupos.some(g => g.slug === "extras"));
});

test("un pancho no ofrece verduras", () => {
    const p = CATALOG.productos.find(x => x.slug === "pancho-con-salsas");
    assert.ok(!p.grupos.some(g => g.slug === "verduras"));
});

test("una bebida no ofrece ninguna opcion", () => {
    assert.equal(CATALOG.productos.find(x => x.slug === "refresco-cola-600ml").grupos.length, 0);
});

// ── priceLine ──

test("producto inexistente no rompe: devuelve error", () => {
    const r = priceLine(CATALOG, { producto_slug: "hamburguesa-de-rana", cantidad: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.errores[0].codigo, "producto_no_encontrado");
});

test("una verdura que no existe se descarta con aviso, la linea sobrevive", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "hamburguesa-completa", cantidad: 1,
        opciones: { verduras: ["lechuga", "rucula"] },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.line.opciones.verduras, ["lechuga"]);
    const aviso = r.avisos.find(a => a.codigo === "opcion_invalida");
    assert.equal(aviso.opcion, "rucula");
});

test("verduras pedidas en un pancho se descartan, el pancho igual entra", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "pancho-con-salsas", cantidad: 1,
        opciones: { verduras: ["lechuga"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.line.precio_linea, 95);
    assert.ok(r.avisos.some(a => a.codigo === "grupo_no_aplica" && a.grupo === "verduras"));
});

test("extras pedidos en una Completa se descartan", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "hamburguesa-completa", cantidad: 1,
        opciones: { verduras: ["lechuga"], extras: ["panceta"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.line.precio_linea, 175, "no debe cobrar la panceta que no aplica");
    assert.ok(r.avisos.some(a => a.codigo === "grupo_no_aplica" && a.grupo === "extras"));
});

test("grupo requerido sin elegir nada frena la linea", () => {
    const r = priceLine(CATALOG, { producto_slug: "hamburguesa-completa", cantidad: 1, opciones: {} });
    assert.equal(r.ok, false);
    const err = r.errores.find(e => e.codigo === "falta_opcion");
    assert.equal(err.grupo, "verduras");
    assert.ok(err.disponibles.length === 10, "le dice al cliente que puede elegir");
});

test("se respeta el maximo del grupo", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "hamburguesa-mixta", cantidad: 1,
        opciones: { salsas: ["mayonesa", "ketchup", "mostaza"], extras: ["panceta","huevo","cheddar"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.line.opciones.extras.length, 3);
});

test("precio con extras: (139 + 60 + 40) x 2 = 478", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "hamburguesa-mixta", cantidad: 2,
        opciones: { extras: ["panceta", "huevo"] },
    });
    assert.equal(r.line.precio_unitario, 239);
    assert.equal(r.line.precio_linea, 478);
});

test("las opciones duplicadas se cobran una sola vez", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "hamburguesa-mixta", cantidad: 1,
        opciones: { extras: ["panceta", "panceta"] },
    });
    assert.equal(r.line.precio_linea, 199);
});

test("el precio que manda el cliente se ignora por completo", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "refresco-cola-600ml", cantidad: 1,
        precio: 1, precio_unitario: 1, precio_linea: 1, total: 1,
    });
    assert.equal(r.line.precio_linea, 70);
});

test("cantidad: 0 -> 1, 999 -> 20, 'dos' -> 1", () => {
    assert.equal(clampCantidad(0), 1);
    assert.equal(clampCantidad(999), 20);
    assert.equal(clampCantidad("dos"), 1);
    assert.equal(clampCantidad(3), 3);
});

test("la nota se recorta y se normaliza", () => {
    const r = priceLine(CATALOG, {
        producto_slug: "refresco-cola-600ml", cantidad: 1,
        nota: "  sin   hielo\n\npor favor  ",
    });
    assert.equal(r.line.nota, "sin hielo por favor");
});

// ── priceCart ──

test("carrito vacio no es valido", () => {
    const r = priceCart(CATALOG, []);
    assert.equal(r.ok, false);
    assert.equal(r.errores[0].codigo, "carrito_vacio");
});

test("carrito completo suma bien y marca el indice del error", () => {
    const r = priceCart(CATALOG, [
        { producto_slug: "hamburguesa-completa", cantidad: 1, opciones: { verduras: ["lechuga","tomate"] } },
        { producto_slug: "refresco-cola-600ml", cantidad: 2 },
        { producto_slug: "hamburguesa-completa", cantidad: 1, opciones: {} },   // sin verduras
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.errores[0].index, 2);
    assert.equal(r.items_total, 175 + 140 + 175);
});

// ── horario ──

test("cerrado_excepcional cierra el local aunque este en horario", () => {
    const s = getOpenState({ horario: { abre: "00:00", cierra: "23:59", cerrado_excepcional: true } });
    assert.equal(s.abierto, false);
});

test("horario que cruza medianoche: 18:30 a 02:00", () => {
    const s = getOpenState({ horario: { abre: "18:30", cierra: "02:00" } });
    assert.equal(typeof s.abierto, "boolean");
    assert.ok(s.abre_en_minutos >= 0 && s.abre_en_minutos < 24 * 60);
    if (!s.abierto) assert.ok(s.abre_en_minutos > 0, "si esta cerrado, falta algo para abrir");
});

test("sin config usa los valores por defecto del local", () => {
    const s = getOpenState({});
    assert.equal(s.abre, "18:30");
    assert.equal(s.cierra, "02:00");
});
