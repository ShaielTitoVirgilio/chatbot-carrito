-- =============================================================
-- 001 · config: parametros del negocio editables sin deploy
-- =============================================================
-- Resuelve dos contradicciones que existen hoy en el codigo:
--   · envio: menu.js dice $30, el prompt de bot.js dice "$50 aprox"
--   · horario: se publica 18:30 pero isOpen() abre 18:35
-- A partir de aca hay UNA fuente y la edita el local desde el dashboard.

create table if not exists config (
  key        text primary key,
  value      jsonb       not null,
  label      text,
  updated_at timestamptz not null default now()
);

comment on table config is 'Parametros del negocio. Editable desde el dashboard de Supabase.';

insert into config (key, value, label) values
  ('horario',
   '{"tz":"America/Montevideo","abre":"18:30","cierra":"02:00","cerrado_excepcional":false}',
   'Horario de atencion'),

  -- costo_sugerido es solo una referencia: el envio real lo fija el empleado
  -- al confirmar, porque depende de la zona y de la demanda del dia.
  ('delivery',
   '{"costo_sugerido":0,"zona":"Paysandu ciudad","leyenda":"El envio te lo confirma el local","PENDIENTE":"cargar costo_sugerido real"}',
   'Delivery'),

  ('pagos',
   '{"retiro":["efectivo","debito"],"delivery":["efectivo"]}',
   'Medios de pago habilitados'),

  ('local',
   '{"nombre":"Carrito del Paseo","direccion":"Zorrilla de San Martin 1835, Paysandu","telefono":"472 28060","whatsapp":"59898302428","instagram":"carrito_del_paseo"}',
   'Datos del local'),

  ('web',
   '{"pedidos_habilitados":true}',
   'Web de pedidos')
on conflict (key) do nothing;
