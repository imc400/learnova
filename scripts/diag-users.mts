/* Diagnóstico: ¿por qué los usuarios nuevos no aparecen en comunidad? */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const profiles = await db.execute(sql`
  select p.id, p.full_name, p.total_xp, p.level, p.created_at,
         (select count(*) from learning_paths lp where lp.user_id = p.id) as rutas,
         (select count(*) from xp_events x where x.user_id = p.id) as eventos_xp
  from profiles p order by p.created_at desc limit 10`);
console.log("PROFILES (últimos 10):");
for (const r of profiles) console.log(JSON.stringify(r));

const authUsers = await db.execute(sql`
  select u.id, u.email, u.created_at,
         (p.id is not null) as tiene_profile
  from auth.users u left join profiles p on p.id = u.id
  order by u.created_at desc limit 10`);
console.log("\nAUTH USERS (últimos 10):");
for (const r of authUsers) console.log(JSON.stringify(r));
process.exit(0);
