import { schedules } from "@trigger.dev/sdk";
import { and, desc, eq, gte, isNull, lte, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptions,
  liveSessions,
  learningPaths,
  nextPathSuggestions,
  profiles,
} from "@/db/schema";
import { env } from "@/lib/env";
import { proRoutesLeftThisMonth } from "@/lib/subscription";
import { enqueueProgressEmail } from "@/lib/email/enqueue";

/*
  Cron diario del ciclo de vida (10:00 America/Santiago) — la promesa "te
  avisamos para renovar" (repetida 6 veces en la UI) por fin tiene sistema:

  1) RENOVACIÓN PRO D-3/D0: el Pro MANUAL (provider_subscription_id IS NULL,
     cancel_at_period_end) expira solo y en silencio. Dos toques: a 3 días del
     vencimiento y el día D. Idempotente por el UNIQUE del outbox
     (dedupeKey = fecha del period_end / `-d0`); si renueva, period_end cambia
     y process.ts además re-chequea antes de enviar.
     Verificado en confirm-pro.ts: renovar antes SUMA los días (extiende desde
     period_end) — el copy lo promete porque el código lo hace.

  2) REENGAGEMENT: compradores de 1 ruta, completada, dormidos ≥14 días y que
     NO continuaron su camino — el pool de recompra. Usa la sugerencia
     CONGELADA de next_path_suggestions (consistente con card y correo de
     cierre). Máx 1/mes por ruta origen (dedupeKey) y respeta frequency cap +
     opt-out granular (allowReengagement) en process.ts.

  GATING (decisión fundador): con LIFECYCLE_EMAILS_ENABLED != "true" el cron
  corre y loguea cuántos encolaría, pero NO encola nada — el fundador aprueba
  los copys y recién ahí enciende el flag. OJO: este cron corre EN el worker
  de Trigger.dev y syncEnvVars (trigger.config.ts) solo sube las envs EN CADA
  DEPLOY — encender/apagar sin deploy requiere cambiar la variable en el
  dashboard de Trigger.dev (y en Vercel para la app). Además process.ts
  re-chequea el flag AL ENVIAR (kill-switch real: apaga también lo ya
  encolado). Checklist completo: docs/runbook-lifecycle-emails.md.
*/

const RENEWAL_WINDOW_DAYS = 3;
const REENGAGEMENT_IDLE_DAYS = 14;
const REENGAGEMENT_BATCH = 200;

export const proRenewalReminderTask = schedules.task({
  id: "pro-renewal-reminder",
  cron: { pattern: "0 10 * * *", timezone: "America/Santiago" },
  maxDuration: 300,
  run: async () => {
    const now = Date.now();
    const enabled = env.LIFECYCLE_EMAILS_ENABLED === "true";

    // ---------- 1) Renovación Pro D-3/D0 ----------
    const expiring = await db
      .select({
        userId: subscriptions.userId,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.plan, "pro"),
          eq(subscriptions.status, "active"),
          // Solo Pro MANUAL: con cobro automático real nadie debe "renovar".
          isNull(subscriptions.providerSubscriptionId),
          gte(subscriptions.currentPeriodEnd, new Date(now)),
          lte(
            subscriptions.currentPeriodEnd,
            new Date(now + RENEWAL_WINDOW_DAYS * 86_400_000),
          ),
        ),
      );

    const renewals: {
      userId: string;
      dedupeKey: string;
      touch: "d3" | "d0";
      periodEnd: Date;
    }[] = [];
    for (const sub of expiring) {
      if (!sub.currentPeriodEnd) continue;
      const hoursLeft = (sub.currentPeriodEnd.getTime() - now) / 3_600_000;
      const dateKey = sub.currentPeriodEnd.toISOString().slice(0, 10);
      // A <24 h solo va el toque D0 (evita 2 correos el mismo día si el D-3
      // nunca alcanzó a salir — p.ej. recién desplegado o sub de 2 días).
      renewals.push(
        hoursLeft <= 24
          ? { userId: sub.userId, dedupeKey: `${dateKey}-d0`, touch: "d0", periodEnd: sub.currentPeriodEnd }
          : { userId: sub.userId, dedupeKey: dateKey, touch: "d3", periodEnd: sub.currentPeriodEnd },
      );
    }

    // ---------- 2) Reengagement (dormidos con camino sin continuar) ----------
    const idleCutoff = new Date(now - REENGAGEMENT_IDLE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const continuation = db
      .select({ one: sql`1` })
      .from(learningPaths)
      .where(
        and(
          eq(learningPaths.userId, nextPathSuggestions.userId),
          eq(learningPaths.sourcePathId, nextPathSuggestions.sourcePathId),
        ),
      );
    const dormant = await db
      .select({
        userId: nextPathSuggestions.userId,
        sourcePathId: nextPathSuggestions.sourcePathId,
        topic: nextPathSuggestions.topic,
        reasons: nextPathSuggestions.reasons,
        pathTitle: learningPaths.title,
        language: learningPaths.language,
      })
      .from(nextPathSuggestions)
      .innerJoin(learningPaths, eq(learningPaths.id, nextPathSuggestions.sourcePathId))
      .innerJoin(profiles, eq(profiles.id, nextPathSuggestions.userId))
      .where(
        and(
          lt(profiles.lastActiveDay, idleCutoff),
          notExists(continuation),
        ),
      )
      .orderBy(desc(nextPathSuggestions.createdAt))
      .limit(REENGAGEMENT_BATCH);
    // Máximo un reengagement por usuario por corrida (el más reciente).
    const seen = new Set<string>();
    const reengage = dormant.filter((d) =>
      seen.has(d.userId) ? false : (seen.add(d.userId), true),
    );

    if (!enabled) {
      const d3 = renewals.filter((r) => r.touch === "d3").length;
      const d0 = renewals.length - d3;
      console.log(
        `[lifecycle] LIFECYCLE_EMAILS_ENABLED=false — encolaría ${renewals.length} pro_expiring (D-3: ${d3}, D0: ${d0}) y ${reengage.length} reengagement. Nada se encoló; para encender sin deploy la env se cambia en el dashboard de Trigger.dev (y en Vercel) — ver docs/runbook-lifecycle-emails.md.`,
      );
      return { gated: true, proExpiring: renewals.length, reengagement: reengage.length };
    }

    // Encolado real (idempotente: UNIQUE del outbox absorbe re-corridas).
    let queuedRenewals = 0;
    for (const r of renewals) {
      const periodStart = new Date(r.periodEnd.getTime() - 30 * 86_400_000);
      // Minutos del pool Pro consumidos en el período pagado (misma aritmética
      // que el servidor de clases: duración real + in_progress acotado a 30',
      // y SOLO kind='class' — la inducción va fuera del cupo, igual que en
      // usedClassMinutes de actions/live; sin el filtro el correo subestimaba).
      const [used] = await db
        .select({
          sec: sql<number>`coalesce(sum(${liveSessions.durationSec}) filter (where ${liveSessions.status} in ('completed', 'missed')), 0)::int`,
          inProgressSec: sql<number>`coalesce(sum(least(extract(epoch from now() - ${liveSessions.startedAt}), 1800)) filter (where ${liveSessions.status} = 'in_progress'), 0)::int`,
        })
        .from(liveSessions)
        .where(
          and(
            eq(liveSessions.userId, r.userId),
            eq(liveSessions.kind, "class"),
            gte(liveSessions.createdAt, periodStart),
          ),
        );
      const usedMin = Math.ceil(
        (Number(used?.sec ?? 0) + Number(used?.inProgressSec ?? 0)) / 60,
      );
      const minutesLeft = Math.max(0, env.PRO_MONTHLY_CLASS_MINUTES - usedMin);
      const routesLeft = await proRoutesLeftThisMonth(r.userId);

      await enqueueProgressEmail(r.userId, "pro_expiring", r.dedupeKey, {
        touch: r.touch,
        proPeriodEnd: r.periodEnd.toISOString(),
        proMinutesLeft: minutesLeft,
        proRoutesLeft: routesLeft,
        amountClp: env.PRICE_PRO_CLP,
      });
      queuedRenewals++;
    }

    let queuedReengagement = 0;
    const monthKey = new Date(now).toISOString().slice(0, 7); // yyyy-mm
    for (const d of reengage) {
      await enqueueProgressEmail(d.userId, "reengagement", `${d.sourcePathId}-${monthKey}`, {
        pathId: d.sourcePathId,
        pathTitle: d.pathTitle,
        language: d.language,
        nextStep: {
          topic: d.topic,
          url: `/app/rutas/${d.sourcePathId}/siguiente?via=email`,
          reasons: d.reasons ?? [],
        },
      });
      queuedReengagement++;
    }

    console.log(
      `[lifecycle] pro-renewal-reminder: ${queuedRenewals} pro_expiring + ${queuedReengagement} reengagement encolados (los repetidos los absorbe el UNIQUE del outbox).`,
    );
    return { gated: false, proExpiring: queuedRenewals, reengagement: queuedReengagement };
  },
});
