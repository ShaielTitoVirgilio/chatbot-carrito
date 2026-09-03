-- =============================================================
-- 013 · lectura publica de config
-- =============================================================
-- config guarda horario, direccion, telefono y medios de pago: exactamente lo
-- que /api/web/catalog y /api/web/status ya publican. Cerrada solo lograba que
-- el catalogo se degradara en silencio.
-- Si alguna vez hay que guardar algo sensible, va en otra tabla.

drop policy if exists config_public_read on config;
create policy config_public_read on config
  for select to anon using (true);
