import { schedules } from "@trigger.dev/sdk";
import { and, isNull, notLike, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { videoBackfillQueue } from "@/db/schema";
import { reanchorLesson } from "@/lib/generation/run";
import { alertFounder } from "@/lib/ops/alert";
import { env } from "@/lib/env";

/**
 * Cron diario que drena video_backfill_queue (E-P0.4): lecciones que quedaron
 * sin video/digest por cuota de YouTube agotada, link-rot del rank 0 o gate
 * de coverage rechazado se re-anclan vía reanchorLesson (digest fresco +
 * contenido + quiz grounded) — en vez de cachear canon degradado o servir un
 * video muerto.
 *
 * Hora: 09:30 UTC = ~1.5 h después del reseteo de cuota de Google
 * (medianoche hora Pacífico) y de madrugada en Chile: cuota fresca, cero
 * competencia con generaciones de usuarios.
 *
 * Los items `link_rot_strike:*` NO entran al drain: son el ledger del
 * 2-strike de refresh.ts (se insertan ya procesados), no trabajo pendiente.
 */
export const backfillVideosTask = schedules.task({
  id: "backfill-videos",
  cron: "30 9 * * *",
  maxDuration: 1800, // cada reanchor llama Gemini + Sonnet: dar holgura
  run: async () => {
    if (env.AI_DISABLED === "true") {
      console.warn("[backfill-videos] AI_DISABLED=true — drain saltado");
      return { skipped: "AI_DISABLED" };
    }

    const pendientes = await db
      .select({
        id: videoBackfillQueue.id,
        lessonId: videoBackfillQueue.lessonId,
        reason: videoBackfillQueue.reason,
      })
      .from(videoBackfillQueue)
      .where(
        and(
          isNull(videoBackfillQueue.processedAt),
          notLike(videoBackfillQueue.reason, "link_rot_strike:%"),
        ),
      )
      .orderBy(sql`${videoBackfillQueue.createdAt} asc`)
      .limit(30); // tope diario: acota costo (Gemini+Sonnet) y cuota

    if (pendientes.length === 0) return { processed: 0 };

    // Una lección puede tener varios items (cuota + link-rot): procesar una vez.
    const porLeccion = new Map<string, string[]>();
    for (const item of pendientes) {
      const ids = porLeccion.get(item.lessonId) ?? [];
      ids.push(item.id);
      porLeccion.set(item.lessonId, ids);
    }

    let ok = 0;
    const fallidas: { lessonId: string; resultado: string }[] = [];
    for (const [lessonId, itemIds] of porLeccion) {
      let resultado: string;
      try {
        resultado = await reanchorLesson(lessonId);
      } catch (e) {
        resultado = `error: ${String(e).slice(0, 150)}`;
      }
      // Se marca procesado SIEMPRE (éxito o no): un item venenoso no puede
      // atascar la cola para siempre — el fallo queda en el log y la alerta.
      await db
        .update(videoBackfillQueue)
        .set({ processedAt: new Date() })
        .where(inArray(videoBackfillQueue.id, itemIds));
      if (resultado.startsWith("anclada")) ok++;
      else fallidas.push({ lessonId, resultado });
      console.log(`[backfill-videos] ${lessonId}: ${resultado}`);
    }

    if (fallidas.length > 0) {
      await alertFounder({
        severidad: "warning",
        titulo: "Backfill de videos con lecciones sin reparar",
        detalle:
          "El drain diario de video_backfill_queue no pudo re-anclar algunas lecciones (sin candidatos vivos o sin digest). Quedan servidas en modo degradado — revisar en admin.",
        contexto: {
          reparadas: ok,
          sinReparar: fallidas.length,
          ejemplos: fallidas
            .slice(0, 3)
            .map((f) => `${f.lessonId.slice(0, 8)}=${f.resultado}`)
            .join(" · "),
        },
      });
    }
    return { processed: porLeccion.size, ok, failed: fallidas.length };
  },
});
