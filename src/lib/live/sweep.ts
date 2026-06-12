import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { liveSessions } from "@/db/schema";
import { env } from "@/lib/env";

/*
  Saneamiento de sesiones huérfanas (pestaña muerta, WiFi caído, batería):
  - durationSec REAL (tiempo transcurrido, cap por tipo de sesión) — sin esto
    el cupo se "reembolsaba" 35 min después de matar la pestaña = clases
    ilimitadas gratis.
  - summarize-class SIEMPRE que haya conversación — el correo de tareas (el
    pedido #1 del fundador) llegaba solo si el alumno cerraba con el botón.
  Lo usan startClassAction (barrido del propio usuario al iniciar) y el cron
  cada 15 min (barrido global: el correo llega aunque el alumno no vuelva).
*/

const MAX_CLASS_SECONDS = 30 * 60;
const MAX_INDUCTION_SECONDS = 12 * 60;
/** Una in_progress más vieja que esto es huérfana (el cliente murió). */
const ORPHAN_AFTER_MINUTES = 35;

export interface SweepResult {
  swept: number;
  summarizeQueued: number;
}

export async function sweepOrphanSessions(opts?: {
  /** Limitar el barrido a un usuario (camino startClassAction). */
  userId?: string;
}): Promise<SweepResult> {
  const conds = [
    eq(liveSessions.status, "in_progress"),
    sql`${liveSessions.createdAt} < now() - interval '${sql.raw(String(ORPHAN_AFTER_MINUTES))} minutes'`,
  ];
  if (opts?.userId) conds.push(eq(liveSessions.userId, opts.userId));

  const swept = await db
    .update(liveSessions)
    .set({
      status: "missed",
      endedAt: new Date(),
      // Duración REAL estimada: epoch desde startedAt (fallback createdAt),
      // cap al máximo del tipo de sesión. summarize-class la afina después
      // con la duración exacta de ElevenLabs si hay transcripción.
      // ::int en los params del CASE: postgres.js los manda sin tipo y dos
      // ramas unknown resuelven a text → `LEAST(numeric, text)` = 42804 y
      // TODO clic de clase moría (fallo real en la demo universidad).
      durationSec: sql`least(
        extract(epoch from now() - coalesce(${liveSessions.startedAt}, ${liveSessions.createdAt})),
        case when ${liveSessions.kind} = 'induction' then ${MAX_INDUCTION_SECONDS}::int else ${MAX_CLASS_SECONDS}::int end
      )::int`,
      updatedAt: new Date(),
    })
    .where(and(...conds))
    .returning({ id: liveSessions.id, conversationId: liveSessions.conversationId });

  let summarizeQueued = 0;
  const withConversation = swept.filter((s) => s.conversationId);
  if (withConversation.length) {
    try {
      if (env.TRIGGER_SECRET_KEY) {
        const { tasks } = await import("@trigger.dev/sdk");
        for (const s of withConversation) {
          // Idempotente: summarizeClass tiene claim atómico por `summary` y el
          // outbox dedupea por sessionId — disparar dos veces no duplica nada.
          await tasks.trigger("summarize-class", { sessionId: s.id });
          summarizeQueued++;
        }
      } else if (env.NODE_ENV !== "production") {
        const { summarizeClass } = await import("@/lib/live/summarize");
        for (const s of withConversation) {
          void summarizeClass(s.id).catch((e) =>
            console.error("[live] resumen inline (sweep) falló:", e),
          );
          summarizeQueued++;
        }
      }
    } catch (e) {
      // El barrido jamás bloquea el flujo que lo llamó; el cron de 15 min
      // NO reintenta estas (ya no están in_progress) pero summarize-class
      // re-disparado a mano desde admin sigue siendo idempotente.
      console.error("[live] no se pudo encolar summarize-class del barrido:", e);
    }
  }

  if (swept.length) {
    console.log(
      `[live] barrido de huérfanas: ${swept.length} sesión(es) → missed, ${summarizeQueued} resumen(es) encolado(s)`,
    );
  }
  return { swept: swept.length, summarizeQueued };
}

/**
 * Red de seguridad del CRON: sesiones ya cerradas (completed/missed) con
 * conversación pero SIN resumen en las últimas 24 h → re-disparar
 * summarize-class. Cubre "el enqueue falló justo al cerrar" y "el barrido
 * marcó missed pero Trigger estaba caído". Idempotente por el claim de
 * `summary` (los in-flight tienen {claiming:true} y no son NULL).
 */
export async function recoverMissingSummaries(limit = 20): Promise<number> {
  if (!env.TRIGGER_SECRET_KEY) return 0;
  const stuck = await db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(
      and(
        inArray(liveSessions.status, ["completed", "missed"]),
        isNotNull(liveSessions.conversationId),
        isNull(liveSessions.summary),
        sql`${liveSessions.updatedAt} > now() - interval '24 hours'`,
      ),
    )
    .limit(limit);
  if (!stuck.length) return 0;
  const { tasks } = await import("@trigger.dev/sdk");
  let queued = 0;
  for (const s of stuck) {
    try {
      await tasks.trigger("summarize-class", { sessionId: s.id });
      queued++;
    } catch (e) {
      console.error(`[live] recover summarize ${s.id} falló:`, e);
    }
  }
  if (queued) console.log(`[live] resúmenes recuperados (cron): ${queued}`);
  return queued;
}
