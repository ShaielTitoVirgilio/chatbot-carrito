-- =============================================================
-- 012 · lectura publica de las opciones del menu
-- =============================================================
-- Las opciones (verduras, extras, salsas y a que producto aplican) son tan
-- publicas como el menu: se muestran a cualquiera que entre a pedir.
-- Bloquearlas con RLS no protegia nada y rompia el catalogo cuando el backend
-- no usaba service_role (los productos aparecian SIN opciones obligatorias).

drop policy if exists option_groups_public_read on option_groups;
create policy option_groups_public_read on option_groups
  for select to anon using (activo = true);

drop policy if exists option_items_public_read on option_items;
create policy option_items_public_read on option_items
  for select to anon using (disponible = true);

drop policy if exists category_options_public_read on category_options;
create policy category_options_public_read on category_options
  for select to anon using (true);

drop policy if exists menu_item_options_public_read on menu_item_options;
create policy menu_item_options_public_read on menu_item_options
  for select to anon using (true);
