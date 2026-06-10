/*
  Re-cura y re-ancla lecciones cuyo video principal quedó fuera de tema
  (ej: video de ansiedad en ruta de fotografía). Busca por patrón en el título
  del video rank-0 y rehace candidatos + anclaje con la lógica nueva
  (routeTopic + relevancia excluyente + coverage floor).
  Uso: npx tsx --env-file=.env scripts/fix-video-mismatch.mts "<patrón>"
*/
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../src/db";
import {
  videoCandidates,
  lessons,
  modules,
  learningPaths,
} from "../src/db/schema";
import { reanchorLesson } from "../src/lib/generation/run";
import { curateVideoForLesson } from "../src/lib/youtube/curate";

const pattern = process.argv[2];
if (!pattern) {
  console.error("Uso: tsx scripts/fix-video-mismatch.mts '<patrón del título>'");
  process.exit(1);
}

const bad = await db
  .select({
    lessonId: videoCandidates.lessonId,
    badTitle: videoCandidates.title,
    lessonTitle: lessons.title,
    pathTitle: learningPaths.title,
    objective: modules.objective,
    language: learningPaths.language,
  })
  .from(videoCandidates)
  .innerJoin(lessons, eq(lessons.id, videoCandidates.lessonId))
  .innerJoin(modules, eq(modules.id, lessons.moduleId))
  .innerJoin(learningPaths, eq(learningPaths.id, modules.pathId))
  .where(and(eq(videoCandidates.rank, 0), ilike(videoCandidates.title, `%${pattern}%`)));

console.log(`Lecciones con video "${pattern}":`, bad.length);

for (const b of bad) {
  console.log("→", b.lessonTitle.slice(0, 50), "| video malo:", b.badTitle?.slice(0, 40));
  await db.delete(videoCandidates).where(eq(videoCandidates.lessonId, b.lessonId));
  const vids = await curateVideoForLesson({
    query: b.lessonTitle,
    objective: b.objective ?? "",
    language: b.language,
    routeTopic: b.pathTitle,
  });
  if (vids.length) {
    await db
      .insert(videoCandidates)
      .values(
        vids.map((v) => ({
          lessonId: b.lessonId,
          youtubeVideoId: v.videoId,
          title: v.title,
          channelTitle: v.channelTitle,
          rank: v.rank,
          score: v.score,
          language: v.language,
          durationSeconds: v.durationSeconds,
          reason: v.reason,
          lastCheckedAt: new Date(),
        })),
      )
      .onConflictDoNothing();
    console.log("  nuevo video:", vids[0]!.title?.slice(0, 60));
    const r = await reanchorLesson(b.lessonId);
    console.log("  reanchor:", r);
  } else {
    console.log("  sin candidatos relevantes — lección queda sin video");
  }
}
console.log("FIX COMPLETO");
process.exit(0);
