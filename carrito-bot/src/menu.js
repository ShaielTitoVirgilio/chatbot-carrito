const supabase = require('./db');

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

let menuCache = null;
let menuCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getMenuAsText() {
    const now = Date.now();
    if (menuCache && now - menuCacheAt < CACHE_TTL_MS) {
        return menuCache;
    }

    const { data, error } = await supabase
        .from('menu')
        .select('categoria, nombre, descripcion, precio')
        .eq('disponible', true)
        .order('categoria')
        .order('orden');

    if (error || !data) {
        console.error('Error fetching menu from Supabase:', error?.message);
        return menuCache || '(menú no disponible)';
    }

    const grouped = {};
    for (const item of data) {
        if (!grouped[item.categoria]) grouped[item.categoria] = [];
        grouped[item.categoria].push(item);
    }

    let text = '';
    for (const [cat, items] of Object.entries(grouped)) {
        text += `\n📌 ${cat.toUpperCase()}\n`;
        for (const item of items) {
            text += `  • ${item.nombre} - $${item.precio} (${item.descripcion})\n`;
        }
    }

    menuCache = text;
    menuCacheAt = now;
    return text;
}

module.exports = { LOCAL_INFO, getMenuAsText };
