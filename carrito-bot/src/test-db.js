// test-db.js
require("dotenv").config({ path: __dirname + "/../.env" });
const supabase = require("./db");

async function test() {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .limit(1);

  if (error) {
    console.error("❌ Error:", error);
  } else {
    console.log("URL:", process.env.SUPABASE_URL);
    console.log("KEY:", process.env.SUPABASE_ANON_KEY?.slice(0, 20));
    console.log("✅ Conectado:", data);
  }
}

test();