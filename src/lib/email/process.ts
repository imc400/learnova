import { and, eq, gte, inArray, lt, or, sql, count } from "drizzle-orm";
import { render } from "@react-email/render";
import { db } from "@/db";
import {
  emailOutbox,
  emailPreferences,
  emailLog,
  profiles,
} from "@/db/schema";
import { env } from "@/lib/env";
import { getResend, emailFrom } from "./client";
import type { ProgressEmailPayload } from "./enqueue";
import { generateProgressEmail } from "@/lib/ai/generate";
import type { EmailContent } from "@/lib/ai/schemas";
import { ProgressEmail } from "../../emails/progress-email";

/*
  Procesa UN evento del outbox (lo invoca el task de Trigger.dev o el modo dev):
  claim atómico → preferencias/opt-out → frequency cap → contenido (IA con
  grounding + post-validación, o determinista) → render React Email → envío
  Resend → email_log. Diseñado para reintentos at-least-once: el claim y el
  UNIQUE del outbox garantizan effectively-once.
*/

type OutboxRow = typeof emailOutbox.$inferSelect;

const TYPE_ALLOW_FIELD: Record<string, keyof typeof emailPreferences.$inferSelect> = {
  module_ready: "allowModuleReady",
  module_learned: "allowLearned",
  path_completed: "allowLearned",
  streak_at_risk: "allowStreak",
  weekly_recap: "allowWeeklyRecap",
  reengagement: "allowReengagement",
  welcome: "allowModuleReady", // transaccional suave; respeta unsubscribedAll
  // class_summary / class_reminder: efectivamente transaccionales (el usuario
  // tomó/agendó la clase explícitamente) — sin campo de opt-out granular,
  // solo respetan unsubscribedAll. No se listan aquí a propósito.
};

/** Tipos exentos del frequency cap: hitos mayores y transaccionales de clase. */
const CAP_EXEMPT = new Set(["path_completed", "class_summary", "class_reminder"]);

async function skip(outboxId: string, reason: string): Promise<string> {
  await db
    .update(emailOutbox)
    .set({ status: "skipped", lastError: reason, updatedAt: new Date() })
    .where(eq(emailOutbox.id, outboxId));
  return `skipped: ${reason}`;
}

/** Post-validación anti-alucinación: bullets anclados a los títulos reales. */
function validateAiContent(
  content: EmailContent,
  payload: ProgressEmailPayload,
): boolean {
  if (!content.subject.trim() || !content.intro.trim()) return false;
  const titles = (payload.lessonTitles ?? []).join(" ").toLowerCase();
  const tokens = new Set(
    titles.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4),
  );
  // Cada bullet debe compartir al menos un token significativo con los títulos.
  const grounded = content.bullets.every((b) => {
    const words = b.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    return words.some((w) => tokens.has(w));
  });
  if (!grounded) return false;
  // Sin quizzes aprobados, no puede haber menciones a quizzes.
  if (!payload.quizzesPassed) {
    const all = `${content.intro} ${content.bullets.join(" ")}`.toLowerCase();
    if (all.includes("quiz") || all.includes("cuestionario")) return false;
  }
  return true;
}

/** Contenido determinista (fallback seguro y para tipos sin IA). */
function deterministicContent(
  type: OutboxRow["type"],
  p: ProgressEmailPayload,
): EmailContent {
  if (type === "module_ready") {
    return {
      subject: `Ya puedes empezar: ${p.moduleTitle}`,
      intro: `El módulo "${p.moduleTitle}" de tu ruta "${p.pathTitle}" quedó listo. Tu siguiente paso te espera.`,
      bullets: (p.lessonTitles ?? []).slice(0, 5),
      cta: "Abrir el módulo",
    };
  }
  if (type === "path_completed") {
    return {
      subject: `🏆 Completaste tu ruta: ${p.pathTitle}`,
      intro: `Terminaste todas las lecciones de "${p.pathTitle}". Esto es constancia de verdad — felicitaciones.`,
      bullets: (p.lessonTitles ?? []).slice(0, 5),
      cta: "Ver mi ruta completa",
    };
  }
  if (type === "class_summary") {
    // moduleTitle = nombre del profesor; lessonTitles = resumen + tareas (📝).
    return {
      subject: `Tu clase con ${p.moduleTitle ?? "tu profesor"}: resumen y tareas`,
      intro: `¡Buena clase! Esto fue lo que trabajaron en "${p.pathTitle}" y lo que tu profesor te dejó para seguir avanzando:`,
      bullets: (p.lessonTitles ?? []).slice(0, 8),
      cta: "Continuar mi ruta",
    };
  }
  if (type === "class_reminder") {
    return {
      subject: `Recordatorio: tu clase de "${p.pathTitle}" se acerca`,
      intro: `Tu profesor te espera. Entra unos minutos antes y ten a mano tus dudas del módulo.`,
      bullets: (p.lessonTitles ?? []).slice(0, 4),
      cta: "Ir a mi ruta",
    };
  }
  // module_learned y demás
  return {
    subject: `🏁 Completaste "${p.moduleTitle}"`,
    intro: `Cerraste el módulo "${p.moduleTitle}" de tu ruta "${p.pathTitle}". Esto fue lo que viste:`,
    bullets: (p.lessonTitles ?? []).slice(0, 5),
    cta: "Seguir con mi ruta",
  };
}

const BADGES: Partial<Record<OutboxRow["type"], string>> = {
  module_ready: "✨ Nuevo módulo disponible",
  module_learned: "🏁 Módulo completado",
  path_completed: "🏆 Ruta completada",
  class_summary: "🎙️ Tu clase en vivo",
  class_reminder: "📅 Clase agendada",
};

export async function processOutboxEmail(outboxId: string): Promise<string> {
  // 1) Claim atómico: procesable si está pending, falló antes (reintento de
  //    Trigger.dev) o quedó 'claimed' colgado >5 min (crash a mitad de vuelo).
  //    'sent'/'skipped' son terminales → no-op (effectively-once).
  const staleClaim = new Date(Date.now() - 5 * 60_000);
  const claimed = await db
    .update(emailOutbox)
    .set({
      status: "claimed",
      attempts: sql`${emailOutbox.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailOutbox.id, outboxId),
        or(
          inArray(emailOutbox.status, ["pending", "failed"]),
          and(
            eq(emailOutbox.status, "claimed"),
            lt(emailOutbox.updatedAt, staleClaim),
          ),
        ),
      ),
    )
    .returning();
  const row = claimed[0];
  if (!row) return "no-op (ya procesado o inexistente)";

  try {
    const resend = getResend();
    if (!resend) return skip(outboxId, "RESEND_API_KEY no configurada");

    // 2) Usuario + preferencias.
    const [user] = await db
      .select({
        email: profiles.email,
        fullName: profiles.fullName,
        locale: profiles.locale,
        totalXp: profiles.totalXp,
        currentStreak: profiles.currentStreak,
      })
      .from(profiles)
      .where(eq(profiles.id, row.userId))
      .limit(1);
    if (!user?.email) return skip(outboxId, "usuario sin email");

    let [prefs] = await db
      .select()
      .from(emailPreferences)
      .where(eq(emailPreferences.userId, row.userId))
      .limit(1);
    if (!prefs) {
      [prefs] = await db
        .insert(emailPreferences)
        .values({ userId: row.userId })
        .onConflictDoNothing({ target: emailPreferences.userId })
        .returning();
      if (!prefs) return skip(outboxId, "sin preferencias");
    }
    if (prefs.unsubscribedAll) return skip(outboxId, "opt-out total");
    const allowField = TYPE_ALLOW_FIELD[row.type];
    if (allowField && prefs[allowField] === false) {
      return skip(outboxId, `opt-out de tipo ${row.type}`);
    }

    // 3) Frequency cap (correos enviados en los últimos 7 días).
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [sentCount] = await db
      .select({ n: count() })
      .from(emailLog)
      .where(and(eq(emailLog.userId, row.userId), gte(emailLog.sentAt, weekAgo)));
    // Hitos mayores y transaccionales de clase siempre pasan; el resto respeta el cap.
    if (!CAP_EXEMPT.has(row.type) && Number(sentCount?.n ?? 0) >= prefs.maxPerWeek) {
      return skip(outboxId, `frequency cap (${prefs.maxPerWeek}/semana)`);
    }

    // 4) Contenido: IA con grounding para hitos de aprendizaje; determinista
    //    para anuncios. SIEMPRE con fallback determinista.
    const payload = (row.payload ?? {}) as ProgressEmailPayload;
    let content = deterministicContent(row.type, payload);
    if (
      (row.type === "module_learned" || row.type === "path_completed") &&
      (payload.lessonTitles?.length ?? 0) > 0
    ) {
      try {
        const ai = await generateProgressEmail({
          kind: row.type === "path_completed" ? "path_completed" : "module_learned",
          pathTitle: payload.pathTitle,
          moduleTitle: payload.moduleTitle,
          lessonTitles: payload.lessonTitles ?? [],
          quizzesPassed: payload.quizzesPassed ?? 0,
          progressPct: payload.progressPct ?? 0,
          language: payload.language ?? user.locale ?? "es",
          firstName: user.fullName?.split(" ")[0] ?? null,
        });
        if (validateAiContent(ai, payload)) content = ai;
        else console.warn(`[email] contenido IA descartado por validación (outbox ${outboxId})`);
      } catch (e) {
        console.error(`[email] generación IA falló, uso fallback (outbox ${outboxId}):`, e);
      }
    }

    // 5) Render + envío.
    const site = env.NEXT_PUBLIC_SITE_URL;
    const unsubscribeUrl = `${site}/api/email/unsubscribe?token=${prefs.unsubToken}`;
    const ctaUrl = payload.pathId ? `${site}/app/rutas/${payload.pathId}` : `${site}/app`;
    const stats: { label: string; value: string }[] = [];
    if (typeof payload.progressPct === "number" && payload.progressPct > 0) {
      stats.push({ label: "Avance", value: `${payload.progressPct}%` });
    }
    if (user.totalXp > 0) stats.push({ label: "XP", value: String(user.totalXp) });
    if (user.currentStreak > 1) stats.push({ label: "Racha", value: `${user.currentStreak} días` });

    const html = await render(
      ProgressEmail({
        preview: content.intro.slice(0, 120),
        badge: BADGES[row.type],
        heading: content.subject.replace(/^([🏁🏆✨🎉]\s*)+/u, ""),
        intro: content.intro,
        bullets: content.bullets,
        bulletsTitle:
          row.type === "module_ready"
            ? "Lo que viene"
            : row.type === "class_summary"
              ? "Resumen y tareas"
              : "Esto aprendiste",
        cta: { label: content.cta, url: ctaUrl },
        secondaryCta:
          row.type === "path_completed" && payload.nextStep
            ? {
                label: `Tu siguiente paso: ${payload.nextStep.topic}`,
                url: `${site}${payload.nextStep.url}`,
              }
            : undefined,
        stats,
        unsubscribeUrl,
      }),
    );

    const sent = await resend.emails.send({
      from: emailFrom(),
      to: [user.email],
      subject: content.subject,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (sent.error) throw new Error(`Resend: ${sent.error.message}`);

    // 6) Log + cierre del outbox.
    await db.insert(emailLog).values({
      userId: row.userId,
      outboxId: row.id,
      type: row.type,
      subject: content.subject,
      providerMessageId: sent.data?.id,
    });
    await db
      .update(emailOutbox)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(emailOutbox.id, outboxId));
    return `sent: ${sent.data?.id}`;
  } catch (err) {
    await db
      .update(emailOutbox)
      .set({
        status: "failed",
        lastError: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, outboxId));
    throw err; // Trigger.dev reintenta; el claim por status evita duplicados
  }
}
