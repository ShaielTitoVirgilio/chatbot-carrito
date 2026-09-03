-- =============================================================
-- 008 · dos imagenes por producto
-- =============================================================
--   thumb_url  -> la chica de la tarjeta del menu (simple, sin fondo)
--   image_url  -> la grande del detalle, al abrir el producto
-- Las dos opcionales: si faltan, la web cae a la imagen de la categoria.

alter table menu add column if not exists thumb_url text;

comment on column menu.thumb_url is
  'Miniatura para la tarjeta del menu. Si es null se usa image_url, y si tampoco hay, la imagen de la categoria.';
comment on column menu.image_url is
  'Foto grande para el detalle del producto. Si es null se usa thumb_url, y si tampoco hay, la imagen de la categoria.';
