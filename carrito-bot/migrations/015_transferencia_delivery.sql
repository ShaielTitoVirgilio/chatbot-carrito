-- =============================================================
-- 015 · transferencia como medio de pago en delivery
-- =============================================================
-- Solo datos. En delivery el cliente elige (obligatorio) efectivo o
-- transferencia; si es transferencia, el mensaje de "confirmado" lleva los
-- datos de la cuenta (src/messages.js).

update config
set value = jsonb_set(value::jsonb, '{delivery}', '["efectivo","transferencia"]'::jsonb)
where key = 'pagos';
