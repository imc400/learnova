import { task } from "@trigger.dev/sdk";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { liveSessions, learningPaths, homeworkItems } from "@/db/schema";
import { enqueueProgressEmail } from "@/lib/email/enqueue";

/*
  Recordatorio de clase agendada (tool agendar_proxima_clase): se dispara con
  `delay` hasta ~3 h antes de la cita. AL CORRER re-verifica que la cita siga
  vigente (fila scheduled + este run en reminder_run_ids): si el alumno
  reagendó, el run viejo se vuelve no-op — jamás un recordatorio fantasma.
  El correo va por el outbox (UNIQUE por sessionId) = effectively-once.
*/

export const classReminderTask = task({
  id: "class-reminder",
  maxDuration: 120,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 60_000 },
  run: async (payload: { scheduledSessionId: string }, { ctx }) => {
    const [session] = await db
      .select({
        id: liveSessions.id,
        userId: liveSessions.userId,
        pathId: liveSessions.pathId,
        status: liveSessions.status,
        scheduledAt: liveSessions.scheduledAt,
        reminderRunIds: liveSessions.reminderRunIds,
      })
      .from(liveSessions)
      .where(eq(liveSessions.id, payload.scheduledSessionId))
      .limit(1);
    if (!session || session.status !== "scheduled") return { skipped: "cita no vigente" };
    if (session.reminderRunIds?.length && !session.reminderRunIds.includes(ctx.run.id)) {
      return { skipped: "reagendada (run reemplazado)" };
    }

    const [path] = await db
      .select({ title: learningPaths.title })
      .from(learningPaths)
      .where(eq(learningPaths.id, session.pathId))
      .limit(1);

    // Tareas pendientes FRESCAS al momento del recordatorio (no las de cuando
    // se agendó): "ten a mano tus dudas" con sustancia real.
    const pending = await db
      .select({ task: homeworkItems.task })
      .from(homeworkItems)
      .where(
        and(
          eq(homeworkItems.userId, session.userId),
          eq(homeworkItems.pathId, session.pathId),
          eq(homeworkItems.done, false),
        ),
      )
      .orderBy(desc(homeworkItems.createdAt), asc(homeworkItems.id))
      .limit(3);

    const fecha = session.scheduledAt
      ? session.scheduledAt
          .toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })
          .replace(/\./g, "")
      : "pronto";

    await enqueueProgressEmail(session.userId, "class_reminder", session.id, {
      pathId: session.pathId,
      pathTitle: path?.title ?? "tu ruta",
      lessonTitles: [
        `Tu clase quedó agendada para el ${fecha}.`,
        ...pending.map((h) => `Tarea pendiente: ${h.task}`),
      ],
    });
    return { sent: true };
  },
});
