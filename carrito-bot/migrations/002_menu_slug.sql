-- =============================================================
-- 002 · menu: slug estable + imagen por producto
-- =============================================================
-- El frontend necesita una clave que no cambie si el local edita el nombre
-- o el precio. El slug se DERIVA del nombre en vez de hardcodearse, asi la
-- migracion funciona con los datos reales que haya hoy en la tabla.

alter table menu add column if not exists slug text;

-- image_url ya existia en la tabla (sin usar). Se documenta y se aprovecha:
-- si es null, la web cae a la imagen de la categoria.
comment on column menu.image_url is
  'Foto del producto. Si es null, la web usa la imagen de la categoria.';

-- slugify sin depender de la extension unaccent (que puede no estar instalada)
create or replace function slugify(txt text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(txt, ''),
      'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
    '[^a-z0-9]+', '-', 'g'))
$$;

-- Slug base desde el nombre; si dos productos colisionan, desempata el orden.
update menu
   set slug = slugify(nombre)
 where slug is null;

with dups as (
  select id, slug,
         row_number() over (partition by slug order by categoria, orden, id) as n
    from menu
)
update menu m
   set slug = m.slug || '-' || d.n
  from dups d
 where m.id = d.id and d.n > 1;

-- Red de seguridad: ningun producto sin slug (nombre vacio, etc.)
update menu set slug = 'item-' || id where slug is null or slug = '';

create unique index if not exists menu_slug_key on menu(slug);
alter table menu alter column slug set not null;

-- Verificacion: esto tiene que devolver 0 filas.
--   select id, nombre, slug from menu where slug like 'item-%';
