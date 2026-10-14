// =============================================
// MENSAJES AL CLIENTE — fuente unica
// =============================================
// Los usan /api/orders/:id/confirm, /ready, /reject y /wa-link (el boton del
// panel que abre WhatsApp con el texto ya escrito).
//
// Antes cada endpoint armaba su propio texto y el de "ready" decia
// "Tene $X en efectivo a mano" aunque el pedido se pagara por transferencia.

const LOCAL_ADDRESS = "Zorrilla de San Martín 1835, Paysandú";

// Se agregan al confirmar un delivery que se paga por transferencia.
const DATOS_TRANSFERENCIA =
    `*Datos para la transferencia:*\n` +
    `Banco: BBVA - Cuenta corriente en pesos uruguayos\n` +
    `N° de cuenta: 22183531\n` +
    `A nombre de: Gabriel Tito Virgilio\n\n` +
    `Enviá el comprobante por acá luego de hacer el pago.`;

const PAYMENT_LABEL = {
    efectivo: "efectivo",
    transferencia: "transferencia",
    debito: "débito",
};

// Sin medio de pago (pedidos de retiro) no se muestra nada: antes se asumia
// "efectivo" y el cliente lo veia en el mensaje sin haberlo elegido.
function paymentLabel(order) {
    if (!order.payment_method) return null;
    return PAYMENT_LABEL[order.payment_method] || order.payment_method;
}

function money(n) {
    return `$${Number(n || 0)}`;
}

function isDelivery(order) {
    return order.type === "delivery";
}

// Linea de total, con el medio de pago REAL del pedido.
function totalLine(order) {
    const medio = paymentLabel(order);
    return `Total: ${money(order.total)}${medio ? ` (${medio})` : ""}`;
}

function confirmedMessage(order) {
    const nombre = order.customer_name ? ` ${order.customer_name}` : "";
    let msg = `*Pedido ${order.order_number} confirmado!*\n\n`;
    msg += `Hola${nombre}, ya lo estamos preparando.\n\n`;

    if (isDelivery(order)) {
        msg += `Te lo enviamos a: ${order.address}\n`;
    } else {
        msg += `Podés retirar en: ${LOCAL_ADDRESS}\n`;
    }
    msg += totalLine(order);

    if (order.eta_minutes) {
        msg += `\nDemora aproximada: ${order.eta_minutes} min`;
    }
    if (isDelivery(order) && order.payment_method === "transferencia") {
        msg += `\n\n${DATOS_TRANSFERENCIA}`;
    }
    return msg;
}

// Delivery -> salio en camino. Retiro -> esta pronto para pasar a buscarlo.
function readyMessage(order) {
    if (isDelivery(order)) {
        let msg = `*Pedido ${order.order_number} en camino!*\n\n`;
        msg += `Ya salió hacia: ${order.address}\n`;
        msg += totalLine(order);
        if (order.payment_method === "efectivo" && order.pays_with) {
            msg += `\nLlevamos cambio de ${money(order.pays_with)}.`;
        }
        return msg;
    }

    let msg = `*Pedido ${order.order_number} listo!*\n\n`;
    msg += `Pasá a retirarlo cuando quieras por ${LOCAL_ADDRESS}.\n`;
    msg += totalLine(order);
    return msg;
}

function deliveredMessage(order) {
    return `*Pedido ${order.order_number} entregado.*\n\n¡Gracias por elegirnos! Cualquier cosa escribinos por acá.`;
}

function rejectedMessage(order) {
    let msg = `*Pedido ${order.order_number}*\n\n`;
    msg += order.rejected_reason
        ? `${order.rejected_reason}\n\n`
        : `No pudimos tomar tu pedido.\n\n`;
    msg += `Si querés, lo ajustamos por acá y lo resolvemos juntos.`;
    return msg;
}

// Resumen para que el empleado arranque la conversacion en WhatsApp.
function newOrderMessage(order) {
    const nombre = order.customer_name ? ` ${order.customer_name}` : "";
    let msg = `¡Hola${nombre}! Recibimos tu pedido ${order.order_number}.\n\n`;
    if (isDelivery(order)) {
        msg += `Envío a: ${order.address}`;
        // La columna real es address_details (antes se leia address_ref, que no
        // existe, y la referencia de la direccion nunca llegaba al mensaje).
        if (order.address_details) msg += ` (${order.address_details})`;
        msg += `\n`;
    } else {
        msg += `Retiro en el local\n`;
    }
    msg += `${totalLine(order)}\n\n`;
    msg += `Te confirmo la demora en un momento.`;
    return msg;
}

const BUILDERS = {
    confirmed: confirmedMessage,
    ready: readyMessage,
    on_the_way: readyMessage,
    done: readyMessage,          // estado viejo del bot de WhatsApp
    delivered: deliveredMessage,
    rejected: rejectedMessage,
    new: newOrderMessage,
};

function buildOrderMessage(order, estado) {
    const build = BUILDERS[estado];
    if (!build) throw new Error(`Estado sin mensaje definido: ${estado}`);
    return build(order);
}

// Normaliza un telefono uruguayo al formato internacional que espera wa.me.
// El cliente escribe "099 123 456", "099123456" o "+598 99 123 456"; wa.me
// solo funciona con 59899123456.
function normalizeUyPhone(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("598")) d = d.slice(3);     // ya tenia el pais
    if (d.startsWith("0")) d = d.slice(1);       // 099... -> 99...
    // Celular uruguayo sin pais: 8 digitos empezando en 9. Fijo: 8 digitos.
    if (d.length < 8 || d.length > 9) return null;
    return `598${d}`;
}

// Link wa.me listo para abrir desde el panel. Devuelve null si no hay telefono
// utilizable, para que el panel muestre el boton deshabilitado en vez de abrir
// un chat con un numero invalido.
function buildWhatsappLink(order, estado) {
    const phone = normalizeUyPhone(order.contact_phone || order.customer_phone);
    if (!phone) return null;
    const texto = buildOrderMessage(order, estado);
    return { url: `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`, texto, phone };
}

// Link al chat con el cliente SIN texto: el empleado escribe lo que quiera.
// Devuelve null si el pedido no tiene un telefono utilizable.
function buildChatLink(order) {
    const phone = normalizeUyPhone(order.contact_phone || order.customer_phone);
    return phone ? `https://wa.me/${phone}` : null;
}

module.exports = { buildOrderMessage, buildWhatsappLink, buildChatLink, normalizeUyPhone, LOCAL_ADDRESS };
