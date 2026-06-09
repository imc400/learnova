import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  learningPaths,
  modules,
  lessons,
  videoCandidates,
  progress,
} from "@/db/schema";

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** Rutas del usuario con su avance real (lecciones completadas / totales). */
export async function listUserPaths(userId: string) {
  const paths = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.userId, userId))
    .orderBy(desc(learningPaths.createdAt));
  if (!paths.length) return [];

  // Conteo por ruta: total de lecciones y completadas por el usuario.
  const stats = await db
    .select({
      pathId: modules.pathId,
      total: sql<number>`count(${lessons.id})::int`,
      done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
    })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .leftJoin(
      progress,
      and(eq(progress.lessonId, lessons.id), eq(progress.userId, userId)),
    )
    .where(
      inArray(
        modules.pathId,
        paths.map((p) => p.id),
      ),
    )
    .groupBy(modules.pathId);

  const byPath = new Map(stats.map((s) => [s.pathId, s]));
  return paths.map((p) => {
    const s = byPath.get(p.id);
    return {
      ...p,
      lessonCount: s?.total ?? 0,
      completedLessons: s?.done ?? 0,
    };
  });
}

/** Devuelve la ruta con su árbol completo (módulos → lecciones → videos) y el
 *  progreso real del usuario (completed por lección + conteos por módulo). */
export async function getPathTree(pathId: string, userId: string) {
  const [path] = await db
    .select()
    .from(learningPaths)
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)))
    .limit(1);
  if (!path) return null;

  const mods = await db
    .select()
    .from(modules)
    .where(eq(modules.pathId, pathId))
    .orderBy(asc(modules.orderIndex));

  const modIds = mods.map((m) => m.id);
  const less = modIds.length
    ? await db
        .select()
        .from(lessons)
        .where(inArray(lessons.moduleId, modIds))
        .orderBy(asc(lessons.orderIndex))
    : [];

  const lessonIds = less.map((l) => l.id);
  const [vids, prog] = await Promise.all([
    lessonIds.length
      ? db
          .select()
          .from(videoCandidates)
          .where(
            and(
              inArray(videoCandidates.lessonId, lessonIds),
              eq(videoCandidates.isActive, true),
              // Cumplimiento YouTube: nunca servir metadatos sin verificar o con > 30 días.
              gt(videoCandidates.lastCheckedAt, sql`now() - interval '30 days'`),
            ),
          )
          .orderBy(asc(videoCandidates.rank))
      : Promise.resolve([]),
    db
      .select({ lessonId: progress.lessonId, status: progress.status })
      .from(progress)
      .where(and(eq(progress.userId, userId), eq(progress.pathId, pathId))),
  ]);

  const completedSet = new Set(
    prog.filter((p) => p.status === "completed").map((p) => p.lessonId),
  );
  const vidsByLesson = groupBy(vids, (v) => v.lessonId);
  const lessonsByModule = groupBy(less, (l) => l.moduleId);

  const tree = {
    ...path,
    modules: mods.map((m) => {
      const moduleLessons = (lessonsByModule.get(m.id) ?? []).map((l) => ({
        ...l,
        videos: vidsByLesson.get(l.id) ?? [],
        completed: completedSet.has(l.id),
      }));
      return {
        ...m,
        lessons: moduleLessons,
        completedCount: moduleLessons.filter((l) => l.completed).length,
      };
    }),
  };

  const lessonCount = tree.modules.reduce((n, m) => n + m.lessons.length, 0);
  const completedLessons = tree.modules.reduce(
    (n, m) => n + m.completedCount,
    0,
  );
  return { ...tree, lessonCount, completedLessons };
}

export type PathTree = NonNullable<Awaited<ReturnType<typeof getPathTree>>>;
