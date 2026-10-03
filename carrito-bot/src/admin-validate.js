// =============================================
// EDITOR DE MENU — validacion de los cambios que manda /editar
// =============================================
// Logica pura, sin Supabase: se testea con `npm test` sin base ni .env.
//
// El editor solo manda lo que CAMBIO el empleado, y aca se revisa campo por
// campo. Nada de lo que llega se pasa tal cual a la base: se arma un objeto
// nuevo con los campos permitidos, asi un body armado a mano no puede tocar
// nombre, categoria, slug ni nada fuera de precio y stock.

const MAX_PRECIO = 100000;       // tope de cordura: un cero de mas no pasa
const MAX_CAMBIOS = 300;         // el menu entero tiene ~35 filas

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esPrecio(v) {
    return Number.isInteger(v) && v >= 0 && v <= MAX_PRECIO;
}

// Devuelve { productos, opciones, errores }.
//   productos: [{ id, precio?, disponible? }]   (al menos uno de los dos;
//              entra como { id, precio?, sin_stock? } y sale con `disponible`)
//   opciones:  [{ id, precio_extra }]
// Si hay un solo error, el llamador no guarda nada: es todo o nada para que el
// empleado no crea que guardo algo que se descarto en silencio.
function parseCambios(body) {
    const errores = [];
    const productos = [];
    const opciones = [];

    const rawProductos = body && body.productos;
    const rawOpciones = body && body.opciones;

    if (rawProductos !== undefined && !Array.isArray(rawProductos)) {
        errores.push({ campo: "productos", codigo: "formato_invalido" });
    }
    if (rawOpciones !== undefined && !Array.isArray(rawOpciones)) {
        errores.push({ campo: "opciones", codigo: "formato_invalido" });
    }
    if (errores.length) return { productos, opciones, errores };

    const listaP = rawProductos || [];
    const listaO = rawOpciones || [];

    if (listaP.length + listaO.length > MAX_CAMBIOS) {
        errores.push({ campo: "cambios", codigo: "demasiados" });
        return { productos, opciones, errores };
    }

    const vistosP = new Set();
    listaP.forEach((c, i) => {
        const id = c && typeof c.id === "string" ? c.id : "";
        if (!UUID.test(id)) {
            errores.push({ campo: `productos[${i}].id`, codigo: "id_invalido" });
            return;
        }
        if (vistosP.has(id)) {
            errores.push({ campo: `productos[${i}].id`, codigo: "repetido" });
            return;
        }
        vistosP.add(id);

        const limpio = { id };
        if (c.precio !== undefined) {
            if (!esPrecio(c.precio)) {
                errores.push({ id, campo: "precio", codigo: "precio_invalido" });
                return;
            }
            limpio.precio = c.precio;
        }
        // El editor habla en "sin_stock" (lo que ve el empleado); la base
        // guarda `disponible`, que es lo contrario. La traduccion vive solo aca.
        if (c.sin_stock !== undefined) {
            if (typeof c.sin_stock !== "boolean") {
                errores.push({ id, campo: "sin_stock", codigo: "debe_ser_booleano" });
                return;
            }
            limpio.disponible = !c.sin_stock;
        }
        if (limpio.precio === undefined && limpio.disponible === undefined) {
            errores.push({ id, campo: "cambio", codigo: "vacio" });
            return;
        }
        productos.push(limpio);
    });

    const vistosO = new Set();
    listaO.forEach((c, i) => {
        const id = c && c.id;
        if (!Number.isInteger(id) || id <= 0) {
            errores.push({ campo: `opciones[${i}].id`, codigo: "id_invalido" });
            return;
        }
        if (vistosO.has(id)) {
            errores.push({ campo: `opciones[${i}].id`, codigo: "repetido" });
            return;
        }
        vistosO.add(id);
        if (!esPrecio(c.precio_extra)) {
            errores.push({ id, campo: "precio_extra", codigo: "precio_invalido" });
            return;
        }
        opciones.push({ id, precio_extra: c.precio_extra });
    });

    return { productos, opciones, errores };
}

module.exports = { parseCambios, MAX_PRECIO, MAX_CAMBIOS };
