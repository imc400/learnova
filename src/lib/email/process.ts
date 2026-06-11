import { and, eq, gte, inArray, lt, or, sql, count } from "drizzle-orm";
import { render } from "@react-email/render";
import { db } from "@/db";
import {
  emailOutbox,
  emailPreferences,
  emailLog,
  profiles,
  routeIntents,
  subscriptions,
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
  // pro_expiring / cart_recovery: cuasi-transaccionales (renovación de SU plan,
  // compra que ÉL inició) — solo unsubscribedAll, igual que las de clase.
};

/** Tipos exentos del frequency cap: hitos mayores y transaccionales de clase.
 *  pro_expiring (la promesa "te avisamos" no puede caer por el cap) y
 *  cart_recovery (2 toques máx por intent, compra iniciada por el usuario)
 *  también pasan — su cadencia la limita el dedupeKey, no el cap. */
const CAP_EXEMPT = new Set([
  "path_completed",
  "class_summary",
  "class_reminder",
  "pro_expiring",
  "cart_recovery",
]);

/** $12.345 → "$12.345" (CLP, es-CL). Para no hardcodear montos en copys. */
function clp(amount: number | undefined): string {
  return typeof amount === "number" ? `$${Math.round(amount).toLocaleString("es-CL")}` : "";
}

/** "14 de junio" — fecha corta es-CL para asuntos e intros (TZ Chile). */
function fechaCorta(iso: string | undefined): string {
  if (!iso) return "pronto";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "pronto";
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    timeZone: "America/Santiago",
  });
}

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
    // \b evita falsos positivos como "quizás"; "cuestionario" va aparte.
    if (/\bquiz(z?es)?\b/i.test(all) || all.includes("cuestionario")) return false;
  }
  return true;
}

/**
 * Contenido determinista (fallback seguro y para tipos sin IA).
 * Devuelve null para los tipos SIN plantilla: el caller hace skip con log —
 * jamás un fallback genérico (eso producía «Completaste "undefined"»).
 */
function deterministicContent(
  type: OutboxRow["type"],
  p: ProgressEmailPayload,
  firstName?: string | null,
): EmailContent | null {
  switch (type) {
    case "module_ready":
      return {
        subject: `Ya puedes empezar: ${p.moduleTitle}`,
        intro: `El módulo "${p.moduleTitle}" de tu ruta "${p.pathTitle ?? "tu ruta"}" quedó listo. Tu siguiente paso te espera.`,
        bullets: (p.lessonTitles ?? []).slice(0, 5),
        cta: "Abrir el módulo",
      };
    case "module_learned":
      return {
        subject: `🏁 Completaste "${p.moduleTitle}"`,
        intro: `Cerraste el módulo "${p.moduleTitle}" de tu ruta "${p.pathTitle ?? "tu ruta"}". Esto fue lo que viste:`,
        bullets: (p.lessonTitles ?? []).slice(0, 5),
        cta: "Seguir con mi ruta",
      };
    case "path_completed":
      return {
        subject: `🏆 Completaste tu ruta: ${p.pathTitle ?? "tu ruta"}`,
        intro: `Terminaste todas las lecciones de "${p.pathTitle ?? "tu ruta"}". Esto es constancia de verdad — felicitaciones.`,
        bullets: (p.lessonTitles ?? []).slice(0, 5),
        cta: "Ver mi ruta completa",
      };
    case "class_summary":
      // moduleTitle = nombre del profesor; lessonTitles = resumen + tareas.
      return {
        subject: `Tu clase con ${p.moduleTitle ?? "tu profesor"}: resumen y tareas`,
        intro: `¡Buena clase! Esto fue lo que trabajaron en "${p.pathTitle ?? "tu ruta"}" y lo que tu profesor te dejó para seguir avanzando:`,
        bullets: (p.lessonTitles ?? []).slice(0, 8),
        cta: "Continuar mi ruta",
      };
    case "class_reminder":
      return {
        subject: `Recordatorio: tu clase de "${p.pathTitle ?? "tu ruta"}" se acerca`,
        intro: `Tu profesor te espera. Entra unos minutos antes y ten a mano tus dudas del módulo.`,
        bullets: (p.lessonTitles ?? []).slice(0, 4),
        cta: "Ir a mi ruta",
      };
    // --- Ciclo de vida de ingresos (encolados por crons GATEADOS por
    //     LIFECYCLE_EMAILS_ENABLED; deterministas, sin IA = cero riesgo) ---
    case "pro_expiring": {
      const fecha = fechaCorta(p.proPeriodEnd);
      const bullets: string[] = [];
      if (typeof p.proMinutesLeft === "number" && p.proMinutesLeft > 0) {
        bullets.push(
          `Te quedan ${p.proMinutesLeft} minutos de clases en vivo de tu período — son tuyos, úsalos`,
        );
      }
      if (typeof p.proRoutesLeft === "number" && p.proRoutesLeft > 0) {
        bullets.push(
          `Te ${p.proRoutesLeft === 1 ? "queda 1 ruta nueva" : `quedan ${p.proRoutesLeft} rutas nuevas`} de tu cupo del mes`,
        );
      }
      // Verificado en confirm-pro.ts: la renovación anticipada extiende desde
      // period_end — la promesa "los días se suman" es literalmente el código.
      bullets.push(`Si renuevas antes del ${fecha}, los días se suman — no pierdes nada`);
      if (p.touch === "d0") {
        return {
          subject: `Hoy termina tu Aulia Pro — sin cobro automático, como prometimos`,
          intro: `Hoy ${fecha} vence tu período Pro. Nadie te cobra solo: si quieres seguir con tus profesores y tus rutas mensuales, renuevas tú — y tus 30 días nuevos parten desde tu vencimiento.`,
          bullets,
          cta: `Renovar 30 días más${p.amountClp ? ` · ${clp(p.amountClp)}` : ""}`,
        };
      }
      return {
        subject: `Tu Aulia Pro termina el ${fecha} — tú decides`,
        intro: `Prometimos avisarte en vez de cobrarte — aquí está el aviso. Tu Pro sigue activo hasta el ${fecha}, y lo que queda de tu período es tuyo:`,
        bullets,
        cta: `Renovar 30 días más${p.amountClp ? ` · ${clp(p.amountClp)}` : ""}`,
      };
    }
    case "cart_recovery": {
      const tema = p.topic ?? "lo que quieres aprender";
      const nombre = firstName ? `${firstName}, tu` : "Tu";
      const bullets = (p.previewModules ?? []).slice(0, 6);
      if (p.touch === "24h") {
        return {
          subject: `Tu ruta de ${tema} sigue reservada — con garantía de 7 días`,
          intro: `${p.previewHook ? `${p.previewHook} ` : ""}Tu temario quedó diseñado y sigue reservado. Y la decisión no tiene letra chica: si en 7 días no es para ti, te devolvemos el 100%. Si vas en serio, con Aulia Pro esta ruta queda incluida, más clases en vivo todos los meses.`,
          bullets,
          cta: `Activar mi ruta${p.amountClp ? ` · ${clp(p.amountClp)}` : ""}`,
        };
      }
      return {
        subject: `${nombre} ruta de ${tema} quedó diseñada y esperándote`,
        intro: `${p.previewHook ? `${p.previewHook} ` : ""}Tu temario está listo y reservado — nadie más lo ve. Esto es lo que te espera:`,
        bullets,
        cta: `Ver mi temario y activarlo${p.amountClp ? ` · ${clp(p.amountClp)}` : ""}`,
      };
    }
    case "reengagement": {
      if (!p.nextStep) return null; // sin sugerencia congelada no hay correo honesto
      return {
        subject: `Tu siguiente ruta sigue esperándote${firstName ? `, ${firstName}` : ""}`,
        intro: `Completaste "${p.pathTitle ?? "tu ruta"}" — eso no es común, la mayoría no llega ni a la mitad. Tu siguiente paso ya está diseñado en borrador: ${p.nextStep.topic}. Construye sobre lo que ya dominas.`,
        bullets: (p.nextStep.reasons ?? []).slice(0, 3),
        cta: `Ver mi siguiente paso`,
      };
    }
    // TODO: el correo de bienvenida aún no existe (2 de 3 de la trilogía);
    // cuando se escriba su plantilla, este case deja de devolver null.
    case "welcome":
    case "streak_at_risk":
    case "weekly_recap":
      return null;
    default:
      return null;
  }
}

/** Etiquetas del badge del correo (sin emojis: regla de marca — gesto = texto). */
const BADGES: Partial<Record<OutboxRow["type"], string>> = {
  module_ready: "Nuevo módulo disponible",
  module_learned: "Módulo completado",
  path_completed: "Ruta completada ✺",
  class_summary: "Tu clase en vivo",
  class_reminder: "Clase agendada",
  pro_expiring: "Tu Aulia Pro",
  cart_recovery: "Tu ruta te espera",
  reengagement: "Tu siguiente paso",
};

/** Preview del inbox: corta en el último espacio antes del límite, con «…». */
function toPreview(intro: string, max = 120): string {
  if (intro.length <= max) return intro;
  const cut = intro.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

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

    // 3.5) Re-chequeo anti-stale del ciclo de vida: entre el enqueue del cron
    //      y el envío pudo pasar lo único que importa (pagó / renovó). Un
    //      correo de recuperación a alguien que YA compró destruye confianza.
    const payload = (row.payload ?? {}) as ProgressEmailPayload;
    if (row.type === "cart_recovery") {
      if (!payload.intentId) return skip(outboxId, "cart_recovery sin intentId");
      const [intent] = await db
        .select({ status: routeIntents.status, pathId: routeIntents.pathId })
        .from(routeIntents)
        .where(eq(routeIntents.id, payload.intentId))
        .limit(1);
      if (!intent || intent.status !== "pending_payment" || intent.pathId) {
        return skip(outboxId, "carro ya resuelto (pagado/convertido/inexistente)");
      }
    }
    if (row.type === "pro_expiring") {
      const [sub] = await db
        .select({
          plan: subscriptions.plan,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, row.userId))
        .limit(1);
      const enqueuedEnd = payload.proPeriodEnd ? new Date(payload.proPeriodEnd).getTime() : 0;
      const currentEnd = sub?.currentPeriodEnd?.getTime() ?? 0;
      if (!sub || sub.plan !== "pro" || sub.status !== "active") {
        return skip(outboxId, "ya no es Pro activo");
      }
      // period_end avanzó respecto del encolado → renovó: el aviso sobra.
      if (enqueuedEnd && currentEnd > enqueuedEnd + 60_000) {
        return skip(outboxId, "ya renovó (period_end avanzó)");
      }
    }

    // 4) Contenido: IA con grounding para hitos de aprendizaje; determinista
    //    para anuncios. SIEMPRE con fallback determinista. Tipos sin plantilla
    //    → skip explícito (jamás el fallback genérico).
    const firstName = user.fullName?.split(" ")[0]?.trim() || null;
    const deterministic = deterministicContent(row.type, payload, firstName);
    if (!deterministic) {
      console.warn(`[email] tipo "${row.type}" sin plantilla — skip (outbox ${outboxId})`);
      return skip(outboxId, `tipo "${row.type}" sin plantilla determinista`);
    }
    let content = deterministic;
    if (
      (row.type === "module_learned" || row.type === "path_completed") &&
      (payload.lessonTitles?.length ?? 0) > 0
    ) {
      try {
        const ai = await generateProgressEmail({
          kind: row.type === "path_completed" ? "path_completed" : "module_learned",
          // Los hitos de aprendizaje siempre la traen; el fallback es defensivo.
          pathTitle: payload.pathTitle ?? "tu ruta",
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
    // Destino del CTA según el tipo: los de ciclo de vida no llevan a la ruta.
    const ctaUrl =
      row.type === "pro_expiring"
        ? `${site}/app/perfil`
        : row.type === "cart_recovery"
          ? `${site}/app/pagar/${payload.intentId}`
          : row.type === "reengagement" && payload.nextStep
            ? `${site}${payload.nextStep.url}`
            : payload.pathId
              ? `${site}/app/rutas/${payload.pathId}`
              : `${site}/app`;
    const stats: { label: string; value: string }[] = [];
    // En los correos de venta (renovación/carro) los chips de avance son ruido.
    const isLifecycle = row.type === "pro_expiring" || row.type === "cart_recovery";
    if (!isLifecycle) {
      if (typeof payload.progressPct === "number" && payload.progressPct > 0) {
        stats.push({ label: "Avance", value: `${payload.progressPct}%` });
      }
      if (user.totalXp > 0) stats.push({ label: "XP", value: String(user.totalXp) });
      if (user.currentStreak > 1) stats.push({ label: "Racha", value: `${user.currentStreak} días` });
    }

    // path_completed con sugerencia: la CTA primaria VENDE la continuación
    // (el único correo del sistema que vende algo no puede venderlo en
    // segundo plano); "ver mi ruta" pasa a secundaria. Las reasons congeladas
    // ("Porque dominaste X") se suman como bullets — grounding ya validado.
    const hasNextStep = row.type === "path_completed" && !!payload.nextStep;
    const primaryCta = hasNextStep
      ? {
          label: `Crear mi siguiente ruta: ${payload.nextStep!.topic}`,
          url: `${site}${payload.nextStep!.url}`,
        }
      : { label: content.cta, url: ctaUrl };
    const secondaryCta = hasNextStep
      ? { label: "Ver mi ruta completa", url: ctaUrl }
      : undefined;
    const bullets = hasNextStep
      ? [...content.bullets, ...(payload.nextStep!.reasons ?? []).slice(0, 2)].slice(0, 7)
      : content.bullets;

    const html = await render(
      ProgressEmail({
        preview: toPreview(content.intro),
        badge: BADGES[row.type],
        // El asunto puede traer emoji (inbox); el heading del cuerpo no.
        heading: content.subject.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, ""),
        intro: content.intro,
        bullets,
        bulletsTitle:
          row.type === "module_ready"
            ? "Lo que viene"
            : row.type === "class_summary"
              ? "Resumen y tareas"
              : row.type === "cart_recovery"
                ? "Tu temario, reservado"
                : row.type === "pro_expiring"
                  ? "Lo que queda de tu período"
                  : row.type === "reengagement"
                    ? "Por qué este paso"
                    : "Esto aprendiste",
        // El candado del carro = el mismo gesto del paywall (temario bloqueado).
        bulletIcon: row.type === "cart_recovery" ? "🔒" : row.type === "pro_expiring" ? "→" : "✓",
        cta: primaryCta,
        secondaryCta,
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
