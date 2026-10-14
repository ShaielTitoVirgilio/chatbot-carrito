// node --test tests/
// Los mensajes se mandan por wa.me: los emojis llegaban a WhatsApp como un
// rombo con signo de pregunta. Estos tests garantizan que ningun mensaje
// vuelva a llevar caracteres fuera de Latin-1 (letras con tilde, ¡ y ¿ entran).

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOrderMessage, buildWhatsappLink } = require("../src/messages");

const ESTADOS = ["new", "confirmed", "ready", "on_the_way", "done", "delivered", "rejected"];

const PEDIDOS = {
    retiro: { order_number: "#001", customer_name: "Ana", type: "retiro", total: 390, payment_method: null, eta_minutes: 20, contact_phone: "099123456" },
    delivery: { order_number: "#002", customer_name: "Luis", type: "delivery", address: "Av Brasil 123", address_details: "reja verde", total: 500, payment_method: "efectivo", pays_with: 1000, eta_minutes: 40, rejected_reason: "No llegamos a esa zona.", contact_phone: "099123456" },
    sinNombre: { order_number: "#003", type: "delivery", address: "X", total: 100, payment_method: "efectivo", contact_phone: "099123456" },
};

for (const [tipo, pedido] of Object.entries(PEDIDOS)) {
    for (const estado of ESTADOS) {
        test(`sin emojis: ${tipo} / ${estado}`, () => {
            const texto = buildOrderMessage(pedido, estado);
            const raros = [...texto].filter((c) => c.codePointAt(0) > 0xff);
            assert.deepEqual(raros, [], `caracteres fuera de Latin-1: ${raros.join(" ")}`);
        });
    }
}

test("el link de WhatsApp lleva el texto y el telefono normalizado", () => {
    const wa = buildWhatsappLink(PEDIDOS.delivery, "confirmed");
    assert.ok(wa.url.startsWith("https://wa.me/59899123456?text="));
    assert.equal(decodeURIComponent(wa.url.split("?text=")[1]), wa.texto);
});

test("el mensaje de pedido nuevo incluye la referencia de la direccion", () => {
    assert.match(buildOrderMessage(PEDIDOS.delivery, "new"), /reja verde/);
});

test("retiro sin medio de pago no muestra parentesis", () => {
    assert.match(buildOrderMessage(PEDIDOS.retiro, "confirmed"), /Total: \$390\n?/);
    assert.doesNotMatch(buildOrderMessage(PEDIDOS.retiro, "confirmed"), /\(/);
});

test("el link de chat no lleva texto y normaliza el telefono", () => {
    const { buildChatLink } = require("../src/messages");
    assert.equal(buildChatLink({ contact_phone: "099 123 456" }), "https://wa.me/59899123456");
    assert.equal(buildChatLink({ customer_phone: "+598 99 123 456" }), "https://wa.me/59899123456");
    assert.equal(buildChatLink({ contact_phone: "abc" }), null);
    assert.equal(buildChatLink({}), null);
});

test("delivery con transferencia: el mensaje de confirmado lleva los datos de la cuenta", () => {
    const pedido = { ...PEDIDOS.delivery, payment_method: "transferencia", pays_with: null, total: 550 };
    const texto = buildOrderMessage(pedido, "confirmed");
    assert.match(texto, /Total: \$550 \(transferencia\)/);
    assert.match(texto, /BBVA - Cuenta corriente en pesos uruguayos/);
    assert.match(texto, /N° de cuenta: 22183531/);
    assert.match(texto, /A nombre de: Gabriel Tito Virgilio/);
    assert.match(texto, /Enviá el comprobante por acá luego de hacer el pago\.$/);
    assert.equal([...texto].filter((c) => c.codePointAt(0) > 0xff).length, 0);
});

test("efectivo y retiro no llevan los datos de la cuenta", () => {
    assert.doesNotMatch(buildOrderMessage(PEDIDOS.delivery, "confirmed"), /22183531/);
    assert.doesNotMatch(buildOrderMessage({ ...PEDIDOS.retiro, payment_method: "transferencia" }, "confirmed"), /22183531/);
});
