// node --test tests/
// Validacion de los cambios del editor de menu: logica pura, sin Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCambios, MAX_PRECIO } = require("../src/admin-validate");

const ID = "41b1c44c-0f81-4268-8595-984a395abe0c";
const ID2 = "33d4f015-9057-46a7-be26-ee35ba170a3e";

test("acepta precio y stock, y traduce sin_stock a disponible", () => {
    const r = parseCambios({
        productos: [
            { id: ID, precio: 150, sin_stock: true },
            { id: ID2, sin_stock: false },
        ],
        opciones: [{ id: 17, precio_extra: 60 }],
    });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.productos, [
        { id: ID, precio: 150, disponible: false },
        { id: ID2, disponible: true },
    ]);
    assert.deepEqual(r.opciones, [{ id: 17, precio_extra: 60 }]);
});

test("el precio 0 es valido (extras gratis)", () => {
    const r = parseCambios({ opciones: [{ id: 1, precio_extra: 0 }] });
    assert.deepEqual(r.errores, []);
    assert.equal(r.opciones[0].precio_extra, 0);
});

test("rechaza precios negativos, decimales, texto y fuera de tope", () => {
    for (const precio of [-1, 10.5, "100", null, NaN, Infinity, MAX_PRECIO + 1]) {
        const r = parseCambios({ productos: [{ id: ID, precio }] });
        assert.equal(r.errores.length, 1, `precio ${String(precio)} deberia fallar`);
        assert.equal(r.productos.length, 0);
    }
    const r = parseCambios({ opciones: [{ id: 1, precio_extra: -5 }] });
    assert.equal(r.errores.length, 1);
});

test("rechaza ids que no son uuid / entero positivo", () => {
    assert.equal(parseCambios({ productos: [{ id: "abc", precio: 10 }] }).errores.length, 1);
    assert.equal(parseCambios({ productos: [{ precio: 10 }] }).errores.length, 1);
    assert.equal(parseCambios({ opciones: [{ id: "5", precio_extra: 10 }] }).errores.length, 1);
    assert.equal(parseCambios({ opciones: [{ id: 0, precio_extra: 10 }] }).errores.length, 1);
});

test("sin_stock tiene que ser booleano de verdad", () => {
    for (const v of ["true", 1, 0, null]) {
        assert.equal(parseCambios({ productos: [{ id: ID, sin_stock: v }] }).errores.length, 1);
    }
});

test("un cambio vacio es un error, no un no-op silencioso", () => {
    assert.equal(parseCambios({ productos: [{ id: ID }] }).errores.length, 1);
});

test("rechaza ids repetidos", () => {
    const r = parseCambios({ productos: [{ id: ID, precio: 1 }, { id: ID, precio: 2 }] });
    assert.equal(r.errores.length, 1);
    assert.equal(r.errores[0].codigo, "repetido");
});

test("ignora campos que no se pueden editar (nombre, slug, categoria)", () => {
    const r = parseCambios({ productos: [{ id: ID, precio: 10, nombre: "X", slug: "y", categoria: "z", disponible: true }] });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.productos, [{ id: ID, precio: 10 }]);
});

test("formato invalido y body vacio", () => {
    assert.equal(parseCambios({ productos: "x" }).errores.length, 1);
    assert.equal(parseCambios({ opciones: {} }).errores.length, 1);
    assert.deepEqual(parseCambios(undefined), { productos: [], opciones: [], errores: [] });
    assert.deepEqual(parseCambios({}), { productos: [], opciones: [], errores: [] });
});

test("corta si mandan demasiados cambios", () => {
    const opciones = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, precio_extra: 1 }));
    assert.equal(parseCambios({ opciones }).errores[0].codigo, "demasiados");
});
