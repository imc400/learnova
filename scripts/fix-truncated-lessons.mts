/*
  Repara lecciones con TEXTO CORTADO (comilla doble sin escapar cerró el campo
  JSON durante la generación → frase tragada). Detecta con la misma heurística
  del pipeline (looksTruncated), regenera el contenido con el prompt nuevo
  (anti-comillas + retry) reusando el digest cacheado del video (sin costo
  Gemini), y actualiza TAMBIÉN el caché canónico para futuros usuarios.
  Uso:  npx tsx --env-file=.env scripts/fix-truncated-lessons.mts --dry   (solo contar)
        npx tsx --env-file=.env scripts/fix-truncated-lessons.mts         (reparar)
*/
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import {
  lessons,
  modules,
  learningPaths,
  videoCandidates,
  lessonContentCache,
} from "../src/db/schema";
import { generateLessonContent, looksTruncated } from "../src/lib/ai/generate";
import { getVideoInsights } from "../src/lib/video/insights";
import type { LessonContent } from "../src/lib/ai/schemas";

const dry = process.argv.includes("--dry");

const rows = await db
  .select({
    lessonId: lessons.id,
    lessonTitle: lessons.title,
    lessonIndex: lessons.orderIndex,
    content: lessons.content,
    moduleTitle: modules.title,
    moduleObjective: modules.objective,
    moduleIndex: modules.orderIndex,
    pathTitle: learningPaths.title,
    level: learningPaths.level,
    language: learningPaths.language,
    cacheKey: learningPaths.skeletonCacheKey,
  })
  .from(lessons)
  .innerJoin(modules, eq(lessons.moduleId, modules.id))
  .innerJoin(learningPaths, eq(modules.pathId, learningPaths.id))
  .where(isNotNull(lessons.content));

type Flagged = (typeof rows)[number] & { badFields: string[] };
const flagged: Flagged[] = [];
for (const r of rows) {
  const c = r.content as LessonContent;
  const bad: string[] = [];
  if (looksTruncated(c.intro)) bad.push("intro");
  (c.sections ?? []).forEach((s, i) => {
    if (looksTruncated(s.body)) bad.push(`sección ${i + 1}: ${s.heading}`);
  });
  if (c.practice && looksTruncated(c.practice)) bad.push("practice");
  if (bad.length) flagged.push({ ...r, badFields: bad });
}

console.log(`Lecciones con contenido: ${rows.length} · CORTADAS: ${flagged.length}`);
for (const f of flagged) {
  console.log(`- [${f.pathTitle.slice(0, 40)}] ${f.lessonTitle} → ${f.badFields.join(" | ")}`);
}
if (dry || !flagged.length) process.exit(0);

let fixed = 0;
const CONCURRENCY = 4;
async function repair(f: Flagged) {
  try {
    // Digest del video principal desde el caché de insights (sin re-pago).
    const [top] = await db
      .select({
        videoId: videoCandidates.youtubeVideoId,
        durationSeconds: videoCandidates.durationSeconds,
      })
      .from(videoCandidates)
      .where(
        and(eq(videoCandidates.lessonId, f.lessonId), eq(videoCandidates.isActive, true)),
      )
      .orderBy(asc(videoCandidates.rank))
      .limit(1);
    const ins = top
      ? await getVideoInsights({
          videoId: top.videoId,
          lessonSummary: `${f.lessonTitle} (contexto de la ruta: ${f.pathTitle})`,
          language: f.language,
          durationSeconds: top.durationSeconds ?? null,
        }).catch(() => null)
      : null;

    const content = await generateLessonContent({
      pathTitle: f.pathTitle,
      moduleTitle: f.moduleTitle,
      moduleObjective: f.moduleObjective ?? "",
      lessonTitle: f.lessonTitle,
      lessonSummary: f.lessonTitle,
      level: f.level,
      language: f.language,
      videoDigest: ins?.digest ?? null,
    });

    await db
      .update(lessons)
      .set({ content, notes: content.keyTakeaways.join("\n• ") })
      .where(eq(lessons.id, f.lessonId));

    // Caché canónico: futuros usuarios del mismo esqueleto reciben la versión sana.
    if (f.cacheKey) {
      await db
        .update(lessonContentCache)
        .set({ content, updatedAt: new Date() })
        .where(
          and(
            eq(lessonContentCache.cacheKey, f.cacheKey),
            eq(lessonContentCache.moduleIndex, f.moduleIndex),
            eq(lessonContentCache.lessonIndex, f.lessonIndex),
          ),
        );
    }
    fixed++;
    console.log(`✓ regenerada (${fixed}/${flagged.length}): ${f.lessonTitle}`);
  } catch (e) {
    console.error(`✗ falló: ${f.lessonTitle}`, e);
  }
}
for (let i = 0; i < flagged.length; i += CONCURRENCY) {
  await Promise.all(flagged.slice(i, i + CONCURRENCY).map(repair));
}
console.log(`Reparadas ${fixed}/${flagged.length}`);
process.exit(0);
