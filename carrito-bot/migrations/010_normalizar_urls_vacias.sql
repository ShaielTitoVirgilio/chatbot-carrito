-- =============================================================
-- 010 · URLs de imagen vacias -> NULL
-- =============================================================
-- Dejar el campo en blanco en el Table Editor guarda '' y no NULL: el
-- producto figuraba "con imagen" en la base pero se veia sin ella en la web.

update menu set image_url = null where btrim(coalesce(image_url, '')) = '';
update menu set thumb_url = null where btrim(coalesce(thumb_url, '')) = '';

create or replace function menu_normalizar_urls() returns trigger
language plpgsql as $$
begin
  if btrim(coalesce(new.image_url, '')) = '' then new.image_url := null; end if;
  if btrim(coalesce(new.thumb_url, '')) = '' then new.thumb_url := null; end if;
  return new;
end $$;

drop trigger if exists menu_normalizar_urls_trigger on menu;
create trigger menu_normalizar_urls_trigger
  before insert or update on menu
  for each row execute function menu_normalizar_urls();
