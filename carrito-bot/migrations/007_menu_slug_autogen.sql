-- =============================================================
-- 007 · slug automatico al cargar productos
-- =============================================================
-- menu.slug es NOT NULL: agregar un producto desde el Table Editor de
-- Supabase sin completarlo daba error. Ahora se genera solo desde el nombre,
-- desambiguando si ya existe uno igual.

create or replace function menu_set_slug() returns trigger
language plpgsql as $$
declare base text; candidato text; n int := 1;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;

  base := slugify(new.nombre);
  if base = '' then base := 'producto'; end if;

  candidato := base;
  while exists (select 1 from menu where slug = candidato and id is distinct from new.id) loop
    n := n + 1;
    candidato := base || '-' || n;
  end loop;

  new.slug := candidato;
  return new;
end $$;

drop trigger if exists menu_slug_trigger on menu;
create trigger menu_slug_trigger
  before insert or update on menu
  for each row execute function menu_set_slug();
