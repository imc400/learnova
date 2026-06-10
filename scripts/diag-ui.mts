/* Usuario+intent temporales para verificación visual — `delete` limpia todo. */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const EMAIL = "diag.ui.aulia@gmail.com";

if (process.argv[2] === "delete") {
  const r = await fetch(`${BASE}/auth/v1/admin/users?per_page=200`, { headers: H });
  const { users } = await r.json();
  const u = users?.find((x: { email: string }) => x.email === EMAIL);
  if (u) {
    await db.execute(sql`delete from route_intents where user_id = ${u.id}`);
    const d = await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
    console.log(d.ok ? "✓ usuario + intent de diagnóstico eliminados" : `✗ ${d.status}`);
  } else console.log("no existía");
  process.exit(0);
}

const r = await fetch(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    email: EMAIL,
    password: "DiagAulia2026!x",
    email_confirm: true,
    user_metadata: { full_name: "Diag UI" },
  }),
});
const j = await r.json();
if (!r.ok) { console.log(`✗ ${r.status}: ${JSON.stringify(j)}`); process.exit(1); }
const rows = await db.execute<{ id: string }>(sql`
  insert into route_intents (user_id, topic, level, goal, prior_experience, amount_clp, preview)
  values (${j.id}, 'Fotografía con celular', 'principiante',
    'Tomar mejores fotos para redes sociales', 'Nunca he editado fotos', 9990,
    '{"modules":["Composición básica","Luz natural","Edición móvil","Color y estilo","Publicar como pro"],"hook":"De fotos planas a un feed que detiene el scroll.","metaDisplay":"Tomar mejores fotos para redes sociales"}'::jsonb)
  returning id`);
console.log("user:", j.id);
console.log("intent:", rows[0].id);
process.exit(0);
