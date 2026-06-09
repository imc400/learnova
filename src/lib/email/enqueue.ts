import { db } from "@/db";
import { emailOutbox } from "@/db/schema";
import { env } from "@/lib/env";

export type ProgressEmailPayload = {
  pathId: string;
  pathTitle: string;
  moduleId?: string;
  moduleTitle?: string;
  lessonTitles?: string[];
  quizzesPassed?: number;
  progressPct?: number;
  language?: string;
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
