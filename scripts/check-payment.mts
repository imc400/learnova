/* Verificación post-pago: intent → paid → ruta → contabilidad. */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const intents = await db.execute(sql`
  select ri.id, ri.topic, ri.status, ri.amount_clp, ri.paid_at, ri.path_id,
         p.email, p.phone, lp.status as path_status, lp.generation_progress
  from route_intents ri
  join profiles p on p.id = ri.user_id
  left join auth.users u on u.id = p.id
  left join learning_paths lp on lp.id = ri.path_id
  order by ri.created_at desc limit 3`);
console.log("ÚLTIMOS INTENTS:");
for (const r of intents) console.log(JSON.stringify(r));

const purchases = await db.execute(sql`
  select provider, amount, currency, status, created_at from path_purchases
  order by created_at desc limit 3`);
console.log("\nCONTABILIDAD (path_purchases):");
for (const r of purchases) console.log(JSON.stringify(r));
process.exit(0);
