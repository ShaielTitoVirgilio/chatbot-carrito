// =============================================
// DATOS DEL LOCAL Y MENÚ COMPLETO
// Carrito del Paseo - Paysandú, Uruguay
// =============================================

const LOCAL_INFO = {
    nombre: "Carrito del Paseo",
    direccion: "Zorrilla de San Martín 1835, Paysandú",
    telefono: "472 28060",
    horarios: "Todos los días de 20:00 a 02:00",
    ciudad: "Paysandú, Uruguay",
    delivery: {
        disponible: true,
        zona: "Dentro de Paysandú ciudad (según demanda podemos ir más lejos)",
        costo: 50,
        metodoPago: "Únicamente efectivo para delivery",
    },
    retiro: {
        disponible: true,
        descripcion: "Podés retirar en el local sin costo adicional",
        metodoPago: "Efectivo o tarjeta en el local",
    },
};

const MENU = {
    hamburguesas: {
        nombre: "Hamburguesas",
        items: [
            { id: "hamb1", nombre: "Hamburguesa Mixta con Tomate y Lechuga", desc: "Hamburguesa hamby (85g) con tomate y lechuga", precio: 139 },
            { id: "hamb2", nombre: "Hamburguesa Con Jamón y Queso", desc: "Hamburguesa hamby (85g) con jamón y queso", precio: 148 },
            { id: "hamb3", nombre: "Hamburguesa Completa", desc: "Hamburguesa hamby (85g) con jamón y queso + verduras a elección", precio: 175 },
            { id: "hamb4", nombre: "Hamburguesa Con Queso Colby y Panceta", desc: "Hamburguesa hamby (85g) con queso colby y panceta", precio: 165 },
            { id: "hamb5", nombre: "Hamburguesa Gigante del Paseo", desc: "Hamburguesa doble hamby con queso colby y panceta", precio: 230 },
            { id: "hamb6", nombre: "Hamburguesa de Pollo Completa", desc: "Hamburguesa sadinesa de pollo con jamón y queso + verduras a elección", precio: 175 },
            { id: "hamb7", nombre: "Hamburguesa de Pollo XL Crocante", desc: "Pechuga de pollo con queso colby, panceta y huevo frito + verduras a elección", precio: 228 },
            { id: "hamb8", nombre: "Hamburguesa Doble XL Carne", desc: "Doble hamburguesa hamby con queso colby, panceta y huevo frito + verduras a elección", precio: 250 },
            { id: "hamb9", nombre: "Cajita Sorpresa", desc: "Hamburguesa, juguete y papas", precio: 175 },
            { id: "hamb10", nombre: "Hamburguesa Veggie", desc: "Hamburguesa 100% vegetariana a base de lenteja", precio: 315 },
        ],
    },
    chivitos: {
        nombre: "Chivitos",
        items: [
            { id: "chiv1", nombre: "Chivito Especial del Paseo", desc: "Churrasco de lomo con queso muzza, panceta, huevo frito, lechuga, tomate y cebolla", precio: 365 },
            { id: "chiv2", nombre: "Chivito Completo del Paseo con Papas Fritas", desc: "Churrasco de lomo con jamón, queso muzza, panceta, huevo frito + verduras a elección y papas fritas", precio: 465 },
        ],
    },
    panchos: {
        nombre: "Panchos",
        items: [
            { id: "pancho1", nombre: "Pancho con Salsas", desc: "Pancho calidad Shneck", precio: 95 },
            { id: "pancho2", nombre: "Pancho con Papitas", desc: "Pancho calidad Shneck con papitas", precio: 120 },
            { id: "pancho3", nombre: "Pancho con Muzzarella", desc: "Pancho calidad Shneck con muzzarella", precio: 135 },
            { id: "pancho4", nombre: "Pancho con Panceta", desc: "Pancho calidad Shneck con panceta", precio: 150 },
            { id: "pancho5", nombre: "Pancho con Muzzarella y Panceta", desc: "Pancho calidad Shneck con muzzarella y panceta", precio: 178 },
        ],
    },
    papas: {
        nombre: "Papas Fritas",
        items: [
            { id: "papas1", nombre: "Papas Fritas Pequeñas", desc: "Calidad Mcein", precio: 65 },
            { id: "papas2", nombre: "Papas Fritas Medianas", desc: "Calidad Mcein", precio: 115 },
            { id: "papas3", nombre: "Papas Fritas Grandes", desc: "Calidad Mcein", precio: 195 },
        ],
    },
    nuggets: {
        nombre: "Nuggets",
        items: [
            { id: "nug1", nombre: "Nuggets de Pollo x7 unidades", desc: "Calidad Sadia", precio: 150 },
        ],
    },
    sandwiches: {
        nombre: "Sándwiches",
        items: [
            { id: "sand1", nombre: "Sándwich Caliente", desc: "Sándwich caliente", precio: 195 },
            { id: "sand2", nombre: "Sándwich Caliente con Muzzarella", desc: "Sándwich caliente con muzzarella", precio: 240 },
        ],
    },
    chorizos: {
        nombre: "Chorizos",
        items: [
            { id: "chorizo1", nombre: "Chorizo con Tomate y Lechuga", desc: "Chorizo extra Centenario (cerdo)", precio: 145 },
            { id: "chorizo2", nombre: "Chorizo Completo", desc: "Chorizo extra Centenario (cerdo) con verduras a elección", precio: 240 },
        ],
    },
    bebidas: {
        nombre: "Bebidas",
        items: [
            { id: "beb1", nombre: "Refresco Cola 600ml", desc: "Botella", precio: 70 },
            { id: "beb2", nombre: "Agua Mineral 500ml", desc: "Botella", precio: 50 },
            { id: "beb3", nombre: "Cerveza Negra Patricia 473ml", desc: "Lata", precio: 50 },
            { id: "beb4", nombre: "Cerveza Rubia Patricia 1L", desc: "Botella", precio: 50 },
        ],
    },
};

// Genera el menú como texto plano para pasarle al bot
function getMenuAsText() {
    let text = "";
    for (const [, categoria] of Object.entries(MENU)) {
        text += `\n📌 ${categoria.nombre.toUpperCase()}\n`;
        for (const item of categoria.items) {
            text += `  • ${item.nombre} - $${item.precio} (${item.desc})\n`;
        }
    }
    return text;
}

module.exports = { LOCAL_INFO, MENU, getMenuAsText };
