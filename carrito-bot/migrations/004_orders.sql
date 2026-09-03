-- =============================================================
-- 004 · orders: soporte para pedidos web
-- =============================================================
-- Aditiva a proposito: el bot de WhatsApp escribe customer_phone y el panel
-- filtra por status='pending' (index.js). Nada de eso se toca.

alter table orders add column if not exists channel         text not null default 'whatsapp';
alter table orders add column if not exists public_token    text;    -- link de seguimiento
alter table orders add column if not exists client_order_id uuid;    -- idempotencia doble-tap
alter table orders add column if not exists items_total     numeric; -- subtotal sin envio
alter table orders add column if not exists delivery_fee    numeric not null default 0;
alter table orders add column if not exists eta_minutes     int;
alter table orders add column if not exists rejected_reason text;
alter table orders add column if not exists customer_note   text;
-- La referencia de direccion ("casa reja verde") va en address_details,
-- que ya existia en la tabla.
alter table orders add column if not exists pays_with       numeric; -- para el vuelto
alter table orders add column if not exists confirmed_at    timestamptz;
alter table orders add column if not exists ready_at        timestamptz;
alter table orders add column if not exists delivered_at    timestamptz;
alter table orders add column if not exists rejected_at     timestamptz;

do $$ begin
  alter table orders add constraint orders_channel_check
    check (channel in ('whatsapp','web'));
exception when duplicate_object then null; end $$;

-- Estados historicos que EXISTEN en la tabla y hay que tolerar:
--   done (7 filas), manual (1), resolved (2), cancelled (1).
-- Se descubrieron al aplicar la migracion: el constraint la rechazo.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in
  ('pending','confirmed','ready','on_the_way','delivered','rejected',
   'done','manual','resolved','cancelled'));

create unique index if not exists orders_public_token_key
  on orders(public_token) where public_token is not null;
create unique index if not exists orders_client_order_id_key
  on orders(client_order_id) where client_order_id is not null;
create index if not exists orders_status_created_idx  on orders(status, created_at desc);
create index if not exists orders_channel_created_idx on orders(channel, created_at desc);

-- Filas existentes: el subtotal era el total (no habia envio desagregado).
update orders set items_total = total where items_total is null;
