// =============================================
// MENSAJES AL CLIENTE — fuente unica
// =============================================
// Los usan /api/orders/:id/confirm, /ready, /reject y /wa-link (el boton del
// panel que abre WhatsApp con el texto ya escrito).
//
// Antes cada endpoint armaba su propio texto y el de "ready" decia
// "Tene $X en efectivo a mano" aunque el pedido se pagara por transferencia.

const LOCAL_ADDRESS = "Zorrilla de San Martín 1835, Paysandú";

const PAYMENT_LABEL = {
    efectivo: "efectivo",
    transferencia: "transferencia",
    debito: "débito",
};

function paymentLabel(order) {
    return PAYMENT_LABEL[order.payment_method] || "efectivo";
}

function money(n) {
    return `$${Number(n || 0)}`;
}

function isDelivery(order) {
    return order.type === "delivery";
}

// Linea de total, con el medio de pago REAL del pedido.
function totalLine(order) {
    return `💵 Total: ${money(order.total)} (${paymentLabel(order)})`;
}

function confirmedMessage(order) {
    const nombre = order.customer_name ? ` ${order.customer_name}` : "";
    let msg = `✅ *Pedido ${order.order_number} confirmado!*\n\n`;
    msg += `Hola${nombre}, ya lo estamos preparando.\n\n`;

    if (isDelivery(order)) {
        msg += `🚚 Te lo enviamos a: ${order.address}\n`;
    } else {
        msg += `🏪 Podés retirar en: ${LOCAL_ADDRESS}\n`;
    }
    msg += totalLine(order);

    if (order.eta_minutes) {
        msg += `\n⏱ Demora aproximada: ${order.eta_minutes} min`;
    }
    return msg;
}

// Delivery -> salio en camino. Retiro -> esta pronto para pasar a buscarlo.
function readyMessage(order) {
    if (isDelivery(order)) {
        let msg = `🏍 *Pedido ${order.order_number} en camino!*\n\n`;
        msg += `Ya salió hacia: ${order.address}\n`;
        msg += totalLine(order);
        if (order.payment_method === "efectivo" && order.pays_with) {
            msg += `\n💰 Llevamos cambio de ${money(order.pays_with)}.`;
        }
        return msg;
    }

    let msg = `🏁 *Pedido ${order.order_number} listo!*\n\n`;
    msg += `🏪 Pasá a retirarlo cuando quieras por ${LOCAL_ADDRESS}.\n`;
    msg += totalLine(order);
    return msg;
}

function deliveredMessage(order) {
    return `🙌 *Pedido ${order.order_number} entregado.*\n\n¡Gracias por elegirnos! Cualquier cosa escribinos por acá.`;
}

function rejectedMessage(order) {
    let msg = `😔 *Pedido ${order.order_number}*\n\n`;
    msg += order.rejected_reason
        ? `${order.rejected_reason}\n\n`
        : `No pudimos tomar tu pedido.\n\n`;
    msg += `Si querés, lo ajustamos por acá y lo resolvemos juntos.`;
    return msg;
}

// Resumen para que el empleado arranque la conversacion en WhatsApp.
function newOrderMessage(order) {
    const nombre = order.customer_name ? ` ${order.customer_name}` : "";
    let msg = `¡Hola${nombre}! Recibimos tu pedido ${order.order_number} 🍔\n\n`;
    if (isDelivery(order)) {
        msg += `🚚 Envío a: ${order.address}`;
        if (order.address_ref) msg += ` (${order.address_ref})`;
        msg += `\n`;
    } else {
        msg += `🏪 Retiro en el local\n`;
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

module.exports = { buildOrderMessage, buildWhatsappLink, normalizeUyPhone, LOCAL_ADDRESS };
