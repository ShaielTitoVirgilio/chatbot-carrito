const { createClient } = require("@supabase/supabase-js");

// El Express es un backend confiable: usa service_role y bypassea RLS.
//
// Esto es lo que permite activar RLS (migracion 006) y cerrar la fuga actual:
// hoy la anon key viaja en el bundle publico de la web y, con RLS desactivado,
// permite leer y borrar orders, customers y messages.
//
// Mientras SUPABASE_SERVICE_ROLE_KEY no este configurada en Railway seguimos
// con la anon key para no romper el deploy, pero avisando fuerte.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!process.env.SUPABASE_URL || !key) {
  console.error("❌ Faltan SUPABASE_URL y/o la clave de Supabase.");
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "⚠️  Usando SUPABASE_ANON_KEY. Configurá SUPABASE_SERVICE_ROLE_KEY antes de\n" +
    "    aplicar la migración 006_rls.sql, o el bot y el panel pierden acceso."
  );
}

const supabase = createClient(process.env.SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabase;
