# Migraciones — Carrito del Paseo

Se aplican **en orden**. No hay herramienta de migraciones en el proyecto: se
corren desde el SQL Editor de Supabase o con `apply_migration` del MCP.

| # | Archivo | Qué hace | Riesgo |
|---|---------|----------|--------|
| 001 | `001_config.sql` | Tabla `config` con horario, delivery, pagos, datos del local | Ninguno (aditiva) |
| 002 | `002_menu_slug.sql` | `slug` único + `imagen_url` en `menu` | Bajo — deriva el slug del nombre real |
| 003 | `003_options.sql` | Verduras / extras / salsas como datos editables | Ninguno (aditiva) |
| 004 | `004_orders.sql` | Campos de pedido web en `orders` | Bajo (aditiva) |
| 005 | `005_order_number.sql` | `next_order_number()` atómico | Ninguno |
| 006 | `006_rls.sql` | **Activa RLS** | ⚠️ Alto — ver abajo |
| 007 | `007_menu_slug_autogen.sql` | Genera el slug solo al cargar productos | Ninguno |
| 008 | `008_menu_thumb.sql` | `thumb_url` (miniatura) además de `image_url` | Ninguno |
| 009 | `009_bucket_menu.sql` | Bucket público `menu` para subir las fotos | Ninguno |
| 010 | `010_normalizar_urls_vacias.sql` | URLs vacías → NULL, con trigger | Ninguno |

## Antes de la 006

1. Crear `SUPABASE_SERVICE_ROLE_KEY` en las variables de Railway.
2. Deployar el cambio de `src/db.js` que la usa.
3. Recién ahí aplicar `006_rls.sql`.
4. **Rotar las claves del proyecto**: la anon key estuvo publicada con RLS
   desactivado, hay que asumirla comprometida.

## Después de aplicar todo

```sql
-- ningún producto sin slug
select id, nombre, slug from menu where slug like 'item-%';

-- los 6 productos con "+verduras a elección"
select m.nombre from menu_item_options mio
  join menu m on m.id = mio.menu_id
  join option_groups g on g.id = mio.group_id
 where g.slug = 'verduras' and mio.enabled;

-- PENDIENTE: precios reales de los extras (hoy en 0)
select slug, nombre, precio_extra from option_items
  where group_id = (select id from option_groups where slug = 'extras');
```
