import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { routeIntents, learningPaths } from "@/db/schema";
import { buildPathInsertValues } from "@/lib/paths/create";
import { enqueuePathGeneration } from "@/lib/generation/run";

/**
 * Si el usuario venía de un paywall (intent pendiente) y AHORA es Pro, su
 * ruta se crea de inmediato consumiendo 1 cupo del mes — el "me suscribo
 * para esta ruta" termina EN la ruta, no en el perfil.
 *
 * TRANSACCIÓN + FOR UPDATE: el webhook de pago del mismo intent contiende
 * por el mismo lock de fila — solo UNO convierte (jamás dos rutas, jamás
 * duplicado en reintentos: estado y pathId se escriben en el mismo commit
 * que crea la ruta).
 */
export async function convertPendingIntent(userId: string): Promise<string | null> {
  const result = await db
    .transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(routeIntents)
        .where(
          and(
            eq(routeIntents.userId, userId),
            eq(routeIntents.status, "pending_payment"),
          ),
        )
        .orderBy(desc(routeIntents.createdAt))
        .limit(1)
        .for("update");
      if (!intent || intent.pathId) return null;

      const [path] = await tx
        .insert(learningPaths)
        .values(
          buildPathInsertValues({
            userId,
            intake: {
              topic: intent.topic,
              goal: intent.goal,
              level: intent.level as "principiante" | "intermedio" | "avanzado",
              language: intent.language,
              priorExperience: intent.priorExperience ?? undefined,
              weeklyHours: intent.weeklyHours ?? undefined,
            },
            sourcePathId: intent.sourcePathId,
          }),
        )
        .returning({ id: learningPaths.id });
      if (!path) throw new Error("insert de ruta falló");

      await tx
        .update(routeIntents)
        .set({ status: "bypassed", pathId: path.id, updatedAt: new Date() })
        .where(eq(routeIntents.id, intent.id));
      return path.id;
    })
    .catch((e) => {
      console.error("[pro] conversión de intent pendiente falló:", e);
      return null;
    });

  if (result) {
    await enqueuePathGeneration(result).catch((e) =>
      console.error(`[pro] enqueue de ruta ${result} falló:`, e),
    );
  }
  return result;
}
