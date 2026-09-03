-- =============================================================
-- 005 · numeracion de pedidos atomica
-- =============================================================
-- getOrderNumber() en bot.js:171-182 usa un contador EN MEMORIA que se
-- resetea en cada deploy de Railway => numeros de pedido REPETIDOS.
-- Ademas cortaba el dia con toDateString() en la TZ del server (UTC), o sea
-- a las 21:00 de Uruguay, en plena hora de servicio.
--
-- Aca el dia comercial corta a las 06:00 local: un pedido de la 01:30
-- pertenece a la noche anterior, que es como lo cuenta el local.

create table if not exists order_counters (
  business_date date primary key,
  last_number   int  not null default 0
);

create or replace function next_order_number() returns text
language plpgsql as $$
declare d date; n int;
begin
  d := ((now() at time zone 'America/Montevideo') - interval '6 hours')::date;

  insert into order_counters (business_date, last_number)
       values (d, 1)
  on conflict (business_date)
    do update set last_number = order_counters.last_number + 1
    returning last_number into n;

  return '#' || lpad(n::text, 3, '0');
end $$;

-- Uso desde el server:  supabase.rpc('next_order_number')
