-- =============================================================
-- 011 · bucket whatsapp-media privado
-- =============================================================
-- Eran fotos de clientes con nombre "${telefono}_${timestamp}.jpg",
-- adivinable por fuerza bruta conociendo el numero. El codigo (index.js)
-- pasa a subir con nombre aleatorio y a firmar URLs temporales al mostrarlas
-- en el panel (createSignedUrl, 1 hora), en vez de usar getPublicUrl.

update storage.buckets set public = false where id = 'whatsapp-media';

drop policy if exists "menu_fotos_lectura_publica" on storage.objects;
create policy "menu_fotos_lectura_publica" on storage.objects
  for select to public using (bucket_id = 'menu');
