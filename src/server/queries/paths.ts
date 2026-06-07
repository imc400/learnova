import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { learningPaths, modules, lessons, videoCandidates } from "@/db/schema";

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

export async function listUserPaths(userId: string) {
  return db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.userId, userId))
    .orderBy(desc(learningPaths.createdAt));
}

/** Devuelve la ruta con su árbol completo (módulos → lecciones → videos). */
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
  const vids = lessonIds.length
    ? await db
        .select()
        .from(videoCandidates)
        .where(
          and(
            inArray(videoCandidates.lessonId, lessonIds),
            eq(videoCandidates.isActive, true),
          ),
        )
        .orderBy(asc(videoCandidates.rank))
    : [];

  const vidsByLesson = groupBy(vids, (v) => v.lessonId);
  const lessonsByModule = groupBy(less, (l) => l.moduleId);

  return {
    ...path,
    modules: mods.map((m) => ({
      ...m,
      lessons: (lessonsByModule.get(m.id) ?? []).map((l) => ({
        ...l,
        videos: vidsByLesson.get(l.id) ?? [],
      })),
    })),
  };
}

export type PathTree = NonNullable<Awaited<ReturnType<typeof getPathTree>>>;
