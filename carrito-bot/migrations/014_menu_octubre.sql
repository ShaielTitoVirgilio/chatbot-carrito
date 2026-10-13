-- =============================================================
-- 014 · cambios de menu de octubre
-- =============================================================
-- Solo datos, no cambia el esquema. Usa slugs en vez de ids para poder
-- correrlo en otra base sin depender de la numeracion.
--
--   · Verduras: opcion "Sin verduras" (slug ninguna, excluye al resto)
--   · Hamburguesa Gigante: ahora lleva verduras
--   · Extras de hamburguesa en toda la categoria (menos Cajita sorpresa)
--   · Extra de carne ($100) solo para Gigante y Completa
--   · Extras de papas con precio segun el tamaño
--   · Sabores nuevos de refrescos; Salus Frutte sin pomelo
--   · Corona 330cc y Norteña en lata: con o sin alcohol
--   · Stella: la 330cc pasa a ser la lata de 473cc (mismo precio) y se suma
--     la botella de 1 Lt

begin;

-- ── Verduras: "Sin verduras" ──
insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden, disponible)
select id, 'ninguna', 'Sin verduras', 0, null, 99, true
from option_groups where slug = 'verduras'
on conflict do nothing;

-- ── Hamburguesa Gigante con verduras ──
insert into menu_item_options (menu_id, group_id, enabled, min_select, requerido, orden)
select m.id, g.id, true, 1, true, 1
from menu m, option_groups g
where m.slug = 'hamburguesa-gigante-del-paseo' and g.slug = 'verduras'
on conflict (menu_id, group_id) do update
  set enabled = true, min_select = 1, requerido = true, orden = 1;

update menu
set descripcion = 'Hamburguesa hamby (85g) con queso colby y panceta + verduras a elección'
where slug = 'hamburguesa-gigante-del-paseo';

-- ── Extras de hamburguesa: panceta 35, salsa cheddar 35, huevo frito 30 ──
update option_items set nombre = 'Panceta extra', precio_extra = 35, orden = 1
where slug = 'panceta' and group_id = (select id from option_groups where slug = 'extras');
update option_items set nombre = 'Salsa cheddar', precio_extra = 35, orden = 2
where slug = 'cheddar' and group_id = (select id from option_groups where slug = 'extras');
update option_items set nombre = 'Huevo frito', precio_extra = 30, orden = 3
where slug = 'huevo' and group_id = (select id from option_groups where slug = 'extras');

insert into category_options (categoria, group_id, enabled, orden)
select 'hamburguesas', id, true, 2 from option_groups where slug = 'extras'
on conflict (categoria, group_id) do update set enabled = true, orden = 2;

-- Completa y Pollo completa tenian los extras apagados a mano: se prenden.
delete from menu_item_options
where group_id = (select id from option_groups where slug = 'extras')
  and menu_id in (select id from menu where slug in ('hamburguesa-completa', 'hamburguesa-de-pollo-completa'))
  and enabled = false;

-- La Cajita sorpresa es un combo cerrado: sin extras.
insert into menu_item_options (menu_id, group_id, enabled)
select m.id, g.id, false
from menu m, option_groups g
where m.slug = 'cajita-sorpresa' and g.slug = 'extras'
on conflict (menu_id, group_id) do update set enabled = false;

-- ── Extra de carne: solo Gigante y Completa ──
insert into option_groups (slug, nombre, tipo, min_select, max_select, requerido, orden, activo)
values ('extra-carne', 'Extra de carne', 'multi', 0, 1, false, 3, true)
on conflict (slug) do nothing;

insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden, disponible)
select id, 'carne', 'Extra de carne', 100, null, 1, true
from option_groups where slug = 'extra-carne'
on conflict do nothing;

insert into menu_item_options (menu_id, group_id, enabled, orden)
select m.id, g.id, true, 3
from menu m, option_groups g
where m.slug in ('hamburguesa-gigante-del-paseo', 'hamburguesa-completa') and g.slug = 'extra-carne'
on conflict (menu_id, group_id) do update set enabled = true, orden = 3;

-- ── Extras de papas: el precio depende del tamaño, por eso un grupo por tamaño ──
insert into option_groups (slug, nombre, tipo, min_select, max_select, requerido, orden, activo) values
  ('extras-papas-grandes',  'Extras', 'multi', 0, null, false, 2, true),
  ('extras-papas-medianas', 'Extras', 'multi', 0, null, false, 2, true),
  ('extras-papas-chicas',   'Extras', 'multi', 0, null, false, 2, true)
on conflict (slug) do nothing;

insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden, disponible)
select g.id, v.slug, v.nombre, v.precio, null, v.orden, true
from (values
  ('extras-papas-grandes',  'panceta', 'Panceta', 80, 1),
  ('extras-papas-grandes',  'cheddar', 'Cheddar', 45, 2),
  ('extras-papas-medianas', 'panceta', 'Panceta', 80, 1),
  ('extras-papas-chicas',   'panceta', 'Panceta', 65, 1)
) as v(grupo, slug, nombre, precio, orden)
join option_groups g on g.slug = v.grupo
on conflict do nothing;

insert into menu_item_options (menu_id, group_id, enabled, orden)
select m.id, g.id, true, 2
from (values
  ('papas-fritas-grandes',  'extras-papas-grandes'),
  ('papas-fritas-medianas', 'extras-papas-medianas'),
  ('papas-fritas-pequenas', 'extras-papas-chicas')
) as v(producto, grupo)
join menu m on m.slug = v.producto
join option_groups g on g.slug = v.grupo
on conflict (menu_id, group_id) do update set enabled = true, orden = 2;

-- ── Refrescos ──
-- 1,5 Lt descartable
insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden, disponible)
select g.id, v.slug, v.nombre, 0, null, v.orden, true
from (values
  ('pepsi', 'Pepsi', 1),
  ('paso-de-los-toros', 'Paso de los Toros', 2),
  ('mirinda', 'Mirinda', 3),
  ('seven-up', 'Seven Up', 4),
  ('pepsi-black', 'Pepsi Black', 5),
  ('paso-de-los-toros-black', 'Paso de los Toros Black', 6)
) as v(slug, nombre, orden)
join option_groups g on g.slug = 'sabor-refresco-1-5l'
on conflict (group_id, slug) do update set nombre = excluded.nombre, orden = excluded.orden, disponible = true;

-- ½ Lt descartable
insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden, disponible)
select g.id, v.slug, v.nombre, 0, null, v.orden, true
from (values
  ('pepsi', 'Pepsi', 1),
  ('paso-de-los-toros', 'Paso de los Toros', 2),
  ('mirinda', 'Mirinda', 3),
  ('seven-up', 'Seven Up', 4),
  ('pepsi-black', 'Pepsi Black', 5),
  ('paso-de-los-toros-black', 'Paso de los Toros Black', 6),
  ('tonica', 'Tónica', 7)
) as v(slug, nombre, orden)
join option_groups g on g.slug = 'bebida-medio-litro'
on conflict (group_id, slug) do update set nombre = excluded.nombre, orden = excluded.orden, disponible = true;

update menu set nombre = 'Refresco ½ Lt. descartable' where id = '41b1c44c-0f81-4268-8595-984a395abe0c';

-- Salus Frutte: naranja y mix frutal (pomelo se apaga, no se borra: hay
-- pedidos viejos que lo nombran)
update option_items set disponible = false
where slug = 'pomelo' and group_id = (select id from option_groups where slug = 'sabor-salus-frutte');
update option_items set orden = 2
where slug = 'mix-frutal' and group_id = (select id from option_groups where slug = 'sabor-salus-frutte');

-- ── Corona 330cc y Norteña en lata: con o sin alcohol ──
insert into option_groups (slug, nombre, tipo, min_select, max_select, requerido, orden, activo)
values ('cerveza-alcohol', 'Tipo', 'single', 1, 1, true, 1, true)
on conflict (slug) do nothing;

insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden, disponible)
select g.id, v.slug, v.nombre, 0, null, v.orden, true
from (values ('con-alcohol', 'Con alcohol', 1), ('sin-alcohol', 'Sin alcohol', 2)) as v(slug, nombre, orden)
join option_groups g on g.slug = 'cerveza-alcohol'
on conflict do nothing;

insert into menu_item_options (menu_id, group_id, enabled, min_select, max_select, requerido, orden)
select m.id, g.id, true, 1, 1, true, 1
from menu m, option_groups g
where m.slug in ('cerveza-corona-330cc', 'cerveza-nortena-en-lata-500cc') and g.slug = 'cerveza-alcohol'
on conflict (menu_id, group_id) do update set enabled = true;

-- ── Stella Artois ──
-- La 330cc no existe: es la lata de 473cc, al mismo precio. El slug queda
-- igual para no romper carritos guardados en el navegador.
update menu
set nombre = 'Cerveza Stella Artois lata 473cc.',
    image_url = '/assets/productos/cerveza-stella-artois-lata-473cc.webp?v=1',
    thumb_url = '/assets/productos/cerveza-stella-artois-lata-473cc-thumb.webp?v=1'
where slug = 'cerveza-stella-artois-330cc';

insert into menu (categoria, nombre, descripcion, precio, disponible, destacado, orden, slug, image_url, thumb_url)
select 'BEBIDAS', 'Cerveza Stella Artois 1 Lt.', '', 320, true, false, 27,
       'cerveza-stella-artois-1-lt',
       '/assets/productos/cerveza-stella-artois-1-lt.webp?v=1',
       '/assets/productos/cerveza-stella-artois-1-lt-thumb.webp?v=1'
where not exists (select 1 from menu where slug = 'cerveza-stella-artois-1-lt');

commit;
