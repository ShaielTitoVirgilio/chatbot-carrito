-- Los pedidos web guardan al cliente en customers (upsert por telefono).
-- La web ademas pide una referencia de la direccion ("timbre 2", "porton verde").
alter table customers add column if not exists referencia text;
