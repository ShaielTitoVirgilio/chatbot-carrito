-- =============================================================
-- 003 · personalizacion de productos
-- =============================================================
-- Hoy estas reglas viven en PROSA dentro del system prompt (bot.js:209-221):
--   "Las verduras se preguntan solo en productos con +verduras a eleccion"
--   "Los panchos NO llevan verduras"
--   "Extras solo para hamburguesas que NO dicen Completa"
--   "Salsas para todo excepto bebidas"
-- Un LLM puede olvidarlas. Aca pasan a ser datos que el local edita sin deploy,
-- y son la MISMA fuente que consume el carrito visual.
--
-- Resolucion en dos capas: category_options define el default de la categoria
-- y menu_item_options lo pisa por producto (enabled=false lo apaga).

create table if not exists option_groups (
  id         serial primary key,
  slug       text unique not null,
  nombre     text not null,
  tipo       text not null default 'multi' check (tipo in ('multi','single')),
  min_select int  not null default 0,
  max_select int,
  requerido  boolean not null default false,
  orden      int  not null default 0,
  activo     boolean not null default true
);

create table if not exists option_items (
  id           serial primary key,
  group_id     int  not null references option_groups(id) on delete cascade,
  slug         text not null,
  nombre       text not null,
  precio_extra numeric not null default 0,
  emoji        text,
  orden        int  not null default 0,
  disponible   boolean not null default true,
  unique (group_id, slug)
);

-- OJO: menu.categoria esta en MAYUSCULAS ('HAMBURGUESAS'). Aca se guarda
-- SIEMPRE en minuscula y catalog.js normaliza al leer, para que no dependa
-- de como este escrito en el menu.
create table if not exists category_options (
  categoria  text not null,
  group_id   int  not null references option_groups(id) on delete cascade,
  enabled    boolean not null default true,
  min_select int, max_select int, requerido boolean,   -- null = hereda del grupo
  orden      int not null default 0,
  primary key (categoria, group_id)
);

create table if not exists menu_item_options (
  menu_id    uuid   not null references menu(id) on delete cascade,
  group_id   int    not null references option_groups(id) on delete cascade,
  enabled    boolean not null default true,
  min_select int, max_select int, requerido boolean,
  orden      int,
  primary key (menu_id, group_id)
);

-- ── Grupos ───────────────────────────────────────────────────
insert into option_groups (slug, nombre, tipo, min_select, max_select, requerido, orden) values
  ('verduras', 'Verduras', 'multi', 0, 10, true,  1),
  ('extras',   'Extras',   'multi', 0, 3,  false, 2),
  ('salsas',   'Salsas',   'multi', 0, 3,  false, 3)
on conflict (slug) do nothing;

-- ── Verduras (lista cerrada, sin costo) ──────────────────────
insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden)
select g.id, v.slug, v.nombre, 0, v.emoji, v.orden
  from option_groups g
  cross join (values
    ('lechuga','Lechuga','🥬',1),   ('tomate','Tomate','🍅',2),
    ('cebolla','Cebolla','🧅',3),   ('choclo','Choclo','🌽',4),
    ('arveja','Arveja','🟢',5),     ('aceituna','Aceituna','🫒',6),
    ('morrones','Morrones','🫑',7), ('hongos','Hongos','🍄',8),
    ('ajies','Ajíes','🌶️',9),       ('pickles','Pickles','🥒',10)
  ) as v(slug,nombre,emoji,orden)
 where g.slug = 'verduras'
on conflict (group_id, slug) do nothing;

-- ── Salsas (sin costo) ───────────────────────────────────────
insert into option_items (group_id, slug, nombre, precio_extra, orden)
select g.id, s.slug, s.nombre, 0, s.orden
  from option_groups g
  cross join (values
    ('mayonesa','Mayonesa',1), ('ketchup','Ketchup',2), ('mostaza','Mostaza',3),
    ('morron','Salsa de morrón',4), ('americana','Salsa americana',5),
    ('barbacoa','Salsa barbacoa',6)
  ) as s(slug,nombre,orden)
 where g.slug = 'salsas'
on conflict (group_id, slug) do nothing;

-- ── Extras ───────────────────────────────────────────────────
-- ⚠️ PENDIENTE: precio_extra en 0. Hoy no existe en ningun lado y el LLM se lo
-- inventaba. Cargar los precios reales ANTES de salir a produccion:
--   update option_items set precio_extra = 60 where slug = 'panceta';
insert into option_items (group_id, slug, nombre, precio_extra, emoji, orden)
select g.id, e.slug, e.nombre, 0, e.emoji, e.orden
  from option_groups g
  cross join (values
    ('panceta','Panceta extra','🥓',1),
    ('huevo','Huevo frito','🍳',2),
    ('cheddar','Queso cheddar','🧀',3)
  ) as e(slug,nombre,emoji,orden)
 where g.slug = 'extras'
on conflict (group_id, slug) do nothing;

-- ── Reglas por categoria ─────────────────────────────────────
-- Salsas: todo MENOS bebidas.
insert into category_options (categoria, group_id, enabled, orden)
select distinct lower(m.categoria), g.id, true, 3
  from menu m cross join option_groups g
 where g.slug = 'salsas' and lower(m.categoria) <> 'bebidas'
on conflict do nothing;

-- Extras: solo hamburguesas.
insert into category_options (categoria, group_id, enabled, orden)
select 'hamburguesas', id, true, 2 from option_groups where slug = 'extras'
on conflict do nothing;

-- Verduras: apagadas por categoria. Se prenden producto por producto, porque
-- dependen del producto y no de la categoria (una "Completa" lleva, una
-- "Mixta con tomate y lechuga" no).
insert into category_options (categoria, group_id, enabled, orden)
select distinct lower(m.categoria), g.id, false, 1
  from menu m cross join option_groups g
 where g.slug = 'verduras'
on conflict do nothing;

-- ── Overrides por producto ───────────────────────────────────
-- Verduras ON en los que dicen "+verduras a eleccion" en la descripcion.
-- Se detecta por el dato real, no por una lista hardcodeada de nombres.
insert into menu_item_options (menu_id, group_id, enabled, min_select, requerido, orden)
select m.id, g.id, true, 1, true, 1
  from menu m cross join option_groups g
 where g.slug = 'verduras'
   and (m.descripcion ilike '%verduras a elecci%n%' or m.descripcion ilike '%verduras a eleccion%')
on conflict (menu_id, group_id) do update
  set enabled = true, min_select = 1, requerido = true;

-- Extras OFF en las hamburguesas "Completa" (ya vienen completas).
insert into menu_item_options (menu_id, group_id, enabled)
select m.id, g.id, false
  from menu m cross join option_groups g
 where g.slug = 'extras'
   and lower(m.categoria) = 'hamburguesas'
   and m.nombre ilike '%completa%'
on conflict (menu_id, group_id) do update set enabled = false;

-- Verificacion esperada:
--   6 productos con verduras -> select count(*) from menu_item_options mio
--     join option_groups g on g.id=mio.group_id where g.slug='verduras' and mio.enabled;
--   panchos sin verduras, bebidas sin nada, Completas sin extras.
