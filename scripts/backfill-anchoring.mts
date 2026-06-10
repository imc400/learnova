/*
  Backfill de anclaje de video: re-ancla las lecciones generadas SIN videoGuide
  (p.ej. cuando la cuota de Gemini se agotó a mitad de generación).
  Uso: npx tsx --env-file=.env scripts/backfill-anchoring.mts <pathId|topic>
*/
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { learningPaths, lessons, modules } from "../src/db/schema";
import { reanchorLesson } from "../src/lib/generation/run";

const arg = process.argv[2];
if (!arg) {
  console.error("Uso: tsx scripts/backfill-anchoring.mts <pathId|topic>");
  process.exit(1);
}

const [path] = await db
  .select({ id: learningPaths.id, title: learningPaths.title })
  .from(learningPaths)
  .where(
    arg.includes("-")
      ? eq(learningPaths.id, arg)
      : eq(learningPaths.topic, arg),
  )
  .orderBy(sql`created_at desc`)
  .limit(1);
if (!path) {
  console.error("Ruta no encontrada:", arg);
  process.exit(1);
}
console.log(`Ruta: ${path.title} (${path.id})`);

const pending = await db
  .select({ id: lessons.id, title: lessons.title })
  .from(lessons)
  .innerJoin(modules, eq(modules.id, lessons.moduleId))
  .where(
    and(
      eq(modules.pathId, path.id),
      isNotNull(lessons.content),
      sql`(${lessons.content}->>'videoGuide' is null or ${lessons.content}->>'videoGuide' = 'null')`,
    ),
  );
console.log(`Lecciones sin anclaje: ${pending.length}`);

// Concurrencia 2: respeta el rate limit de Gemini recién activado.
let ok = 0;
for (let i = 0; i < pending.length; i += 2) {
  const batch = pending.slice(i, i + 2);
  const results = await Promise.allSettled(
    batch.map(async (l) => {
      const r = await reanchorLesson(l.id);
      console.log(`  [${i + batch.indexOf(l) + 1}/${pending.length}] ${l.title.slice(0, 50)} → ${r}`);
      if (r.startsWith("anclada")) ok++;
      return r;
    }),
  );
  for (const r of results) {
    if (r.status === "rejected") console.error("  ✗ falló:", String(r.reason).slice(0, 120));
  }
}
console.log(`\nBackfill completo: ${ok}/${pending.length} lecciones ancladas.`);
process.exit(0);
