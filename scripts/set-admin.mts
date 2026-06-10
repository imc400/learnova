/* Activa is_admin para los correos indicados.
   Uso: npx tsx --env-file=.env scripts/set-admin.mts correo1 [correo2…] */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const emails = process.argv.slice(2);
if (!emails.length) {
  console.error("Uso: tsx scripts/set-admin.mts <email> [...]");
  process.exit(1);
}
for (const email of emails) {
  const res = await db.execute(sql`
    update profiles set is_admin = true, updated_at = now()
    where id in (select id from auth.users where lower(email) = ${email.toLowerCase()})
    returning id`);
  console.log(res.length ? `✓ admin: ${email}` : `✗ no encontrado: ${email}`);
}
process.exit(0);
