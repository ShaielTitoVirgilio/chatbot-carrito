-- =============================================================
-- 009 · bucket para las fotos del menu
-- =============================================================
-- El local sube las imagenes desde Storage en el dashboard de Supabase y pega
-- la URL publica en menu.thumb_url (miniatura) o menu.image_url (grande).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
   set public = true,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists "menu_fotos_lectura_publica" on storage.objects;
create policy "menu_fotos_lectura_publica" on storage.objects
  for select to public using (bucket_id = 'menu');
