import { db } from "@/db";
import { emailOutbox } from "@/db/schema";
import { env } from "@/lib/env";

export type ProgressEmailPayload = {
  // Opcionales porque los correos de ciclo de vida (pro_expiring/cart_recovery)
  // no nacen de una ruta; los flujos de avance SIEMPRE los setean.
  pathId?: string;
  pathTitle?: string;
  moduleId?: string;
  moduleTitle?: string;
  lessonTitles?: string[];
  quizzesPassed?: number;
  progressPct?: number;
  language?: string;
  /** CTA del correo path_completed/reengagement: la siguiente ruta sugerida
   *  (reasons = "Porque dominaste X", congeladas con la sugerencia). */
  nextStep?: { topic: string; url: string; reasons?: string[] };
  /** Toque de la secuencia de ciclo de vida: D-3/D0 (Pro) o T+1h/T+24h (carro). */
  touch?: "d3" | "d0" | "1h" | "24h";
  // --- pro_expiring (renovación manual D-3/D0) ---
  /** ISO de current_period_end al ENCOLAR: si al procesar cambió, ya renovó → skip. */
  proPeriodEnd?: string;
  proMinutesLeft?: number;
  proRoutesLeft?: number;
  // --- cart_recovery (intent pending_payment sin ruta) ---
  intentId?: string;
  topic?: string;
  previewHook?: string;
  previewModules?: string[];
  /** Precio en CLP del CTA (ruta o Pro), para no hardcodear montos en copys. */
  amountClp?: number;
};

/*
  Encola un correo de avance de forma idempotente:
  1) INSERT en email_outbox con UNIQUE(user,type,dedupe) — un reintento o un
     hito repetido NO duplica el evento (effectively-once).
  2) Si el evento es nuevo, dispara el task de Trigger.dev (prod) o procesa
     inline (dev), mismo patrón que enqueuePathGeneration.
  Nunca lanza: un fallo de correo jamás debe romper progreso/XP del usuario.
*/
export async function enqueueProgressEmail(
  userId: string,
  type: (typeof emailOutbox.$inferInsert)["type"],
  dedupeKey: string,
  payload: ProgressEmailPayload,
): Promise<void> {
  try {
    const inserted = await db
      .insert(emailOutbox)
      .values({ userId, type, dedupeKey, payload })
      .onConflictDoNothing({
        target: [emailOutbox.userId, emailOutbox.type, emailOutbox.dedupeKey],
      })
      .returning({ id: emailOutbox.id });
    const outboxId = inserted[0]?.id;
    if (!outboxId) return; // ya encolado/enviado antes
    if (env.TRIGGER_SECRET_KEY) {
      const { tasks } = await import("@trigger.dev/sdk");
      await tasks.trigger("send-progress-email", { outboxId });
    } else if (env.NODE_ENV !== "production") {
      // Dev sin Trigger: procesa inline sin bloquear la respuesta.
      const { processOutboxEmail } = await import("./process");
      void processOutboxEmail(outboxId).catch((e) =>
        console.error("[email] inline (dev) falló:", e),
      );
    }
  } catch (err) {
    console.error(`[email] enqueue falló (${type}, user ${userId}):`, err);
  }
}
