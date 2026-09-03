-- =============================================================
-- 006 · RLS — cierra la fuga de datos de clientes
-- =============================================================
-- ⚠️ ORDEN DE APLICACION IMPORTANTE
-- Aplicar esta migracion DESPUES de haber puesto SUPABASE_SERVICE_ROLE_KEY en
-- Railway y deployado el cambio de src/db.js. Si se aplica antes, el bot y el
-- panel pierden acceso a la base.
--
-- Problema que resuelve: VITE_SUPABASE_ANON_KEY viaja en el bundle publico de
-- la web y RLS estaba desactivado. Esa clave permitia select/insert/update/
-- delete sobre orders, customers y messages: nombres, telefonos y direcciones
-- de todos los clientes, legibles y borrables por cualquiera que abriera el
-- bundle. La clave ya estuvo publicada => ROTARLA ademas de esto.

alter table menu              enable row level security;
alter table orders            enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table customers         enable row level security;
alter table settings          enable row level security;
alter table config            enable row level security;
alter table option_groups     enable row level security;
alter table option_items      enable row level security;
alter table category_options  enable row level security;
alter table menu_item_options enable row level security;
alter table order_counters    enable row level security;

-- Unica policy anonima del proyecto: el menu es publico y de solo lectura.
-- Sostiene el Menu.jsx actual de la web mientras migra a /api/web/catalog.
drop policy if exists menu_public_read on menu;
create policy menu_public_read on menu
  for select to anon
  using (disponible = true);

-- Todo lo demas: RLS activo y CERO policies => anon no lee ni escribe nada.
-- El Express usa service_role, que bypassea RLS por diseno.

-- Verificacion (con la anon key, deberia devolver 0 filas / error de permiso):
--   select * from orders limit 1;
--   select * from customers limit 1;
