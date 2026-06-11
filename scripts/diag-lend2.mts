import { sql } from "drizzle-orm";
import { db } from "../src/db";
const [u] = await db.execute<{ id: string }>(sql`select id from profiles where email = 'diag.ui.aulia@gmail.com'`);
// Prestar la ruta de ALFAJORES (la del bug reportado, con clases+tareas reales)
const ALFA = (await db.execute<{ id: string }>(sql`select id from learning_paths where title ilike '%alfajor%' order by created_at desc limit 1`))[0].id;
const [owner] = await db.execute<{ user_id: string }>(sql`select user_id from learning_paths where id = ${ALFA}`);
console.log("alfa path:", ALFA, "owner original:", owner.user_id);
await db.execute(sql`update learning_paths set user_id = ${u.id} where id = ${ALFA}`);
const [l] = await db.execute<{ id: string }>(sql`
  select l.id from lessons l join modules m on m.id = l.module_id
  where m.path_id = ${ALFA} and l.content is not null order by m.order_index, l.order_index limit 1`);
console.log("leccion:", l?.id);
