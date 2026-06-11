import crypto from "node:crypto";
import { and, eq, isNull, lt, gt, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { routeIntents, learningPaths, emailOutbox, pathPurchases } from "@/db/schema";
import { confirmIntentPaid } from "@/lib/payments/confirm-intent";
import { confirmProMonthPaid, markProMonthFailed } from "@/lib/payments/confirm-pro";
import { enqueuePathGeneration } from "@/lib/generation/run";
import { activeProvider } from "@/lib/payments/provider";
import { alertFounder } from "@/lib/ops/alert";
import { env } from "@/lib/env";

/*
  Reconciliación (E-P0.3): "dinero cobrado sin producto" pasa de invisible a
  auto-reparado en ≤5 minutos. Los pasos de la auditoría de robustez:

  1.  Intent 'paid' SIN path → re-llamar confirmIntentPaid (es claimable en ese
      estado: FOR UPDATE + claim atómico lo hacen seguro ante concurrencia).
  2.  Intent 'pending_payment' >15 min → consultar AL PROVEEDOR (webhook
      perdido): si Flow/MP dicen pagado, confirmar nosotros.
  2b. Compra Pro manual (prom_<purchaseId>) 'pending' >15 min → consultar a
      Flow: pagada → confirmProMonthPaid (idempotente); rechazada/anulada →
      markProMonthFailed. Sin esto, el ticket más alto del negocio ($24.990)
      quedaba cobrado sin Pro si webhook Y retorno del navegador se perdían.
  3.  Ruta 'draft' >10 min → enqueuePathGeneration (idempotente).
  4.  Ruta 'generating' >50 min → strike counter PERSISTIDO
      (generation_requeues): strike 1 = re-enqueue (resume vía
      lesson_content_cache); strike >=2 = 'failed' + alerta. El viejo umbral
      por minutos era inalcanzable: runPathGeneration resetea
      generation_started_at en cada run.
  4b. Ruta 'generating' que sale de la ventana de 48 h → 'failed' + alerta
      crítica (ninguna ruta pagada queda en limbo eterno sin botón Reintentar).
  5.  Ruta 'ready' con progress<100 y quieta >30 min → re-enqueue (rellena).
  6.  email_outbox pending/failed quieto >10 min → re-disparar el task (cierra
      el hueco de enqueue.ts cuando tasks.trigger lanzó tras el INSERT).

  La invocan DOS disparadores en dominios de fallo distintos: el cron de
  Trigger.dev (src/trigger/reconcile.ts) y un Vercel Cron vía
  /api/admin/reconcile — si Trigger está caído, su cron también lo está.
  Toda la lógica es idempotente: correr ambos a la vez es seguro.

  Las consultas firmadas a Flow/MP de este archivo son SOLO LECTURA
  (getStatusByCommerceId / payments/search); la única escritura de pagos pasa
  por confirmIntentPaid, el punto único de verdad.
*/

export interface ReconcileReport {
  paidSinRuta: number;
  webhooksPerdidosConfirmados: number;
  proWebhooksPerdidosConfirmados: number;
  draftsReencoladas: number;
  generandoReencoladas: number;
  generandoAFailed: number;
  generandoExpiradas48h: number;
  readyIncompletasReencoladas: number;
  outboxReintentados: number;
  errores: string[];
}

/* ---------- Consultas read-only al proveedor (webhook perdido) ---------- */

/** Firma Flow (HMAC-SHA256 de pares ordenados) — solo para la consulta de estado. */
function flowSign(params: Record<string, string>, secretKey: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return crypto.createHmac("sha256", secretKey).update(toSign).digest("hex");
}

/** Estado en Flow por commerceOrder (`intent_<id>` / `prom_<id>`).
 *  null = sin respuesta útil. `status` crudo de Flow para que el caller
 *  distinga rechazado/anulado (3/4) de simplemente pendiente (1). */
async function flowStatusByCommerceId(
  commerceId: string,
): Promise<{ paid: boolean; status: number | null; amount: number } | null> {
  if (!env.FLOW_API_KEY || !env.FLOW_SECRET_KEY) return null;
  try {
    const params: Record<string, string> = { apiKey: env.FLOW_API_KEY, commerceId };
    const s = flowSign(params, env.FLOW_SECRET_KEY);
    const qs = new URLSearchParams({ ...params, s }).toString();
    const res = await fetch(`${env.FLOW_BASE_URL}/payment/getStatusByCommerceId?${qs}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null; // típicamente 400 = orden no existe en Flow
    const j = (await res.json()) as { status?: number; amount?: string };
    // Flow: 1 pendiente · 2 pagado · 3 rechazado · 4 anulado
    return { paid: j.status === 2, status: j.status ?? null, amount: Number(j.amount ?? 0) };
  } catch {
    return null;
  }
}

/** Estado en Mercado Pago por external_reference. null = sin respuesta útil. */
async function mpStatusByReference(
  externalReference: string,
): Promise<{ paid: boolean; amount: number } | null> {
  if (!env.MP_ACCESS_TOKEN) return null;
  try {
    const qs = new URLSearchParams({
      external_reference: externalReference,
      sort: "date_created",
      criteria: "desc",
    }).toString();
    const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${qs}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      results?: { status?: string; transaction_amount?: number }[];
    };
    const approved = (j.results ?? []).find((p) => p.status === "approved");
    if (approved) return { paid: true, amount: Number(approved.transaction_amount ?? 0) };
    return { paid: false, amount: 0 };
  } catch {
    return null;
  }
}

/**
 * Reconciliación ACTIVA de un intent pendiente: pregunta a los proveedores
 * con credenciales configuradas y, si alguno reporta pagado, confirma vía
 * confirmIntentPaid. La usan el paso 2 del cron y la página de retorno de
 * pago (E-P1.4 — la señal más fuerte de "probablemente pagó").
 */
export async function reconcileIntentWithProvider(
  intentId: string,
): Promise<"paid" | "pending" | "unknown"> {
  const ref = `intent_${intentId}`;
  let answered = false;

  const mp = await mpStatusByReference(ref);
  if (mp) {
    answered = true;
    if (mp.paid) {
      await confirmIntentPaid({
        intentId,
        provider: "mercadopago",
        chargedAmountClp: mp.amount,
      });
      return "paid";
    }
  }

  const flow = await flowStatusByCommerceId(ref);
  if (flow) {
    answered = true;
    if (flow.paid) {
      await confirmIntentPaid({ intentId, provider: "flow", chargedAmountClp: flow.amount });
      return "paid";
    }
  }

  return answered ? "pending" : "unknown";
}

/* ------------------------------ Cron ------------------------------ */

export async function runReconciliation(): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    paidSinRuta: 0,
    webhooksPerdidosConfirmados: 0,
    proWebhooksPerdidosConfirmados: 0,
    draftsReencoladas: 0,
    generandoReencoladas: 0,
    generandoAFailed: 0,
    generandoExpiradas48h: 0,
    readyIncompletasReencoladas: 0,
    outboxReintentados: 0,
    errores: [],
  };

  // 1) Dinero cobrado SIN ruta — el incidente que mata la confianza.
  try {
    const huerfanos = await db
      .select({ id: routeIntents.id, amountClp: routeIntents.amountClp })
      .from(routeIntents)
      .where(and(eq(routeIntents.status, "paid"), isNull(routeIntents.pathId)))
      .limit(10);
    for (const intent of huerfanos) {
      try {
        const r = await confirmIntentPaid({
          intentId: intent.id,
          provider: activeProvider(),
          chargedAmountClp: intent.amountClp ?? 0,
        });
        report.paidSinRuta++;
        await alertFounder({
          severidad: "critical",
          titulo: `Intent pagado sin ruta reparado: ${intent.id.slice(0, 8)}`,
          detalle:
            "La reconciliación encontró un pago confirmado sin ruta creada y re-ejecutó la confirmación. Verificar en admin que la generación avance.",
          contexto: { intentId: intent.id, resultado: r, montoClp: intent.amountClp },
        });
      } catch (e) {
        report.errores.push(`paid-sin-ruta ${intent.id}: ${String(e).slice(0, 150)}`);
      }
    }
  } catch (e) {
    report.errores.push(`paso1: ${String(e).slice(0, 150)}`);
  }

  // 2) Webhook perdido: pendientes >15 min (ventana 48 h) → preguntar al proveedor.
  try {
    const pendientes = await db
      .select({ id: routeIntents.id })
      .from(routeIntents)
      .where(
        and(
          eq(routeIntents.status, "pending_payment"),
          lt(routeIntents.createdAt, sql`now() - interval '15 minutes'`),
          gt(routeIntents.createdAt, sql`now() - interval '48 hours'`),
        ),
      )
      .orderBy(sql`${routeIntents.createdAt} desc`)
      .limit(10);
    for (const intent of pendientes) {
      try {
        const r = await reconcileIntentWithProvider(intent.id);
        if (r === "paid") {
          report.webhooksPerdidosConfirmados++;
          await alertFounder({
            severidad: "warning",
            titulo: `Webhook perdido recuperado: ${intent.id.slice(0, 8)}`,
            detalle:
              "El proveedor reportó el pago como acreditado pero el webhook nunca llegó (o falló). La reconciliación confirmó el intent y la ruta ya se está generando.",
            contexto: { intentId: intent.id },
          });
        }
      } catch (e) {
        report.errores.push(`webhook ${intent.id}: ${String(e).slice(0, 150)}`);
      }
    }
  } catch (e) {
    report.errores.push(`paso2: ${String(e).slice(0, 150)}`);
  }

  // 2b) Webhook perdido de compras Pro manuales (commerceOrder `prom_<id>`):
  // si Flow cobró y NI el webhook NI /api/flow/pro-return aterrizaron (usuario
  // cerró el navegador), path_purchases queda 'pending' eterno — $24.990
  // cobrados sin Pro, intent del paywall sin convertir, cero alertas. Las
  // compras Pro son Flow-only (provider hardcodeado), así que basta Flow.
  try {
    const proPendientes = await db
      .select({ id: pathPurchases.id, amount: pathPurchases.amount })
      .from(pathPurchases)
      .where(
        and(
          eq(pathPurchases.kind, "pro_month"),
          eq(pathPurchases.status, "pending"),
          lt(pathPurchases.createdAt, sql`now() - interval '15 minutes'`),
          gt(pathPurchases.createdAt, sql`now() - interval '48 hours'`),
        ),
      )
      .orderBy(sql`${pathPurchases.createdAt} desc`)
      .limit(10);
    for (const purchase of proPendientes) {
      try {
        const flow = await flowStatusByCommerceId(`prom_${purchase.id}`);
        if (!flow) continue; // sin respuesta útil — lo retoma el próximo ciclo
        if (flow.paid) {
          // Idempotente (FOR UPDATE + claim por status); al activar convierte
          // internamente el intent pendiente del paywall.
          await confirmProMonthPaid({
            purchaseId: purchase.id,
            chargedAmountClp: flow.amount,
          });
          report.proWebhooksPerdidosConfirmados++;
          await alertFounder({
            severidad: "warning",
            titulo: `Webhook Pro perdido recuperado: ${purchase.id.slice(0, 8)}`,
            detalle:
              "Flow reporta la compra pro_month como pagada, pero ni el webhook ni el retorno del navegador la confirmaron. La reconciliación activó el Pro (idempotente) y convirtió el intent pendiente si lo había.",
            contexto: { purchaseId: purchase.id, montoFlowClp: flow.amount },
          });
        } else if (flow.status === 3 || flow.status === 4) {
          // Rechazado/anulado en Flow → cerrar también ese limbo (solo pasa
          // de 'pending' a 'failed'; nunca pisa una compra ya pagada).
          await markProMonthFailed(purchase.id);
        }
      } catch (e) {
        report.errores.push(`pro-pending ${purchase.id}: ${String(e).slice(0, 150)}`);
      }
    }
  } catch (e) {
    report.errores.push(`paso2b: ${String(e).slice(0, 150)}`);
  }

  // 3) Rutas 'draft' viejas: el enqueue post-creación murió.
  try {
    const drafts = await db
      .select({ id: learningPaths.id })
      .from(learningPaths)
      .where(
        and(
          eq(learningPaths.status, "draft"),
          lt(learningPaths.createdAt, sql`now() - interval '10 minutes'`),
          gt(learningPaths.createdAt, sql`now() - interval '48 hours'`),
        ),
      )
      .limit(10);
    for (const p of drafts) {
      try {
        await enqueuePathGeneration(p.id);
        report.draftsReencoladas++;
        await alertFounder({
          severidad: "warning",
          titulo: `Ruta draft re-encolada: ${p.id.slice(0, 8)}`,
          detalle:
            "Una ruta llevaba >10 min en draft sin generación encolada (Trigger caído al crearla). La reconciliación la re-encoló.",
          contexto: { pathId: p.id },
        });
      } catch (e) {
        report.errores.push(`draft ${p.id}: ${String(e).slice(0, 150)}`);
      }
    }
  } catch (e) {
    report.errores.push(`paso3: ${String(e).slice(0, 150)}`);
  }

  // 4) 'generating' colgadas — strike counter PERSISTIDO (generation_requeues).
  // maxDuration del task es 45 min: >50 min sin avance = run muerto. El viejo
  // criterio ">110 min = failed" era inalcanzable cuando el re-run SÍ
  // arrancaba: runPathGeneration resetea generation_started_at al inicio de
  // CADA run, así que el reloj volvía a cero y el ciclo re-encolaba para
  // siempre (≈50 runs en 48 h quemando tokens y cuota de YouTube). El
  // contador NO se resetea entre runs: strike 1 = re-enqueue (resume vía
  // lesson_content_cache); strike >=2 = failed + alerta (botón Reintentar).
  // TODO(run.ts — otro agente está en ese archivo): cuando runPathGeneration
  // marque 'failed' en su catch (~línea 883), resetear generation_requeues a 0
  // igual que aquí, para que el Reintentar manual parta con ciclo limpio.
  // runPathGeneration NO debe tocar generation_requeues en ningún otro punto
  // (el diseño exige que el contador sobreviva al reset de started_at).
  try {
    const colgadas = await db
      .select({
        id: learningPaths.id,
        startedAt: learningPaths.generationStartedAt,
      })
      .from(learningPaths)
      .where(
        and(
          eq(learningPaths.status, "generating"),
          lt(learningPaths.generationStartedAt, sql`now() - interval '50 minutes'`),
          gt(learningPaths.createdAt, sql`now() - interval '48 hours'`),
        ),
      )
      .limit(10);
    for (const p of colgadas) {
      const minutos = p.startedAt
        ? Math.round((Date.now() - p.startedAt.getTime()) / 60_000)
        : null;
      try {
        // CLAIM atómico: incrementa el strike Y refresca generation_started_at
        // en la misma sentencia. Los DOS disparadores (cron de Trigger cada
        // 5 min + Vercel Cron cada 10 min) pueden ver la misma ruta colgada;
        // el segundo ya no matchea el WHERE (started_at quedó fresco) → ni
        // doble strike ni doble run.
        const [claimed] = await db
          .update(learningPaths)
          .set({
            generationRequeues: sql`${learningPaths.generationRequeues} + 1`,
            generationStartedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(learningPaths.id, p.id),
              eq(learningPaths.status, "generating"),
              lt(learningPaths.generationStartedAt, sql`now() - interval '50 minutes'`),
            ),
          )
          .returning({ requeues: learningPaths.generationRequeues });
        if (!claimed) continue; // el otro disparador la reclamó en esta ventana

        if (claimed.requeues >= 2) {
          // 2º strike: ya sobrevivió a un re-enqueue completo → failed real.
          // El contador vuelve a 0 para que el Reintentar manual (ops.ts pasa
          // failed → generating) arranque un ciclo de strikes limpio.
          await db
            .update(learningPaths)
            .set({ status: "failed", generationRequeues: 0, updatedAt: new Date() })
            .where(and(eq(learningPaths.id, p.id), eq(learningPaths.status, "generating")));
          report.generandoAFailed++;
          await alertFounder({
            severidad: "critical",
            titulo: `Generación colgada marcada failed: ${p.id.slice(0, 8)}`,
            detalle:
              "La ruta acumuló 2 strikes de re-enqueue (generation_requeues): el run re-encolado arrancó y volvió a morir. Quedó en failed: el cliente ve el botón Reintentar y en admin está el replay.",
            contexto: { pathId: p.id, strikes: claimed.requeues, minutosColgada: minutos },
          });
        } else if (env.TRIGGER_SECRET_KEY) {
          // 1er strike: re-enqueue directo con idempotencyKey (cinturón extra
          // al claim: si tasks.trigger se duplicara, Trigger.dev dedupea). TTL
          // corto: el mismo strike re-armado tras un failed+retry (contador
          // reseteado) genera la misma key, y para entonces ya expiró.
          const { tasks } = await import("@trigger.dev/sdk");
          await tasks.trigger(
            "generate-path",
            { pathId: p.id },
            {
              idempotencyKey: `reconcile-gen-${p.id}-s${claimed.requeues}`,
              idempotencyKeyTTL: "1h",
            },
          );
          report.generandoReencoladas++;
        } else {
          // Dev sin Trigger: enqueuePathGeneration cae al modo inline.
          await enqueuePathGeneration(p.id);
          report.generandoReencoladas++;
        }
      } catch (e) {
        report.errores.push(`generating ${p.id}: ${String(e).slice(0, 150)}`);
      }
    }
  } catch (e) {
    report.errores.push(`paso4: ${String(e).slice(0, 150)}`);
  }

  // 4b) Limbo post-48h: el paso 4 filtra por createdAt > now()-48h, así que
  // una 'generating' que cruza la ventana quedaría eterna — sin failed, sin
  // botón Reintentar, sin alerta, con dinero cobrado. Barrido terminal: failed
  // + alerta crítica. (Set pequeñísimo por diseño: el paso 4 las resuelve
  // antes; esto es la red de seguridad, no el camino feliz.)
  try {
    const expiradas = await db
      .update(learningPaths)
      .set({ status: "failed", generationRequeues: 0, updatedAt: new Date() })
      .where(
        and(
          eq(learningPaths.status, "generating"),
          lt(learningPaths.createdAt, sql`now() - interval '48 hours'`),
        ),
      )
      .returning({ id: learningPaths.id });
    for (const p of expiradas) {
      report.generandoExpiradas48h++;
      await alertFounder({
        severidad: "critical",
        titulo: `Ruta >48h en generating cerrada como failed: ${p.id.slice(0, 8)}`,
        detalle:
          "La ruta salió de la ventana de reconciliación de 48 h sin terminar de generarse — esto NO debería pasar (el paso 4 debió resolverla antes). Quedó en failed para que el cliente recupere el botón Reintentar; revisar el historial de runs en Trigger.dev.",
        contexto: { pathId: p.id },
      });
    }
  } catch (e) {
    report.errores.push(`paso4b: ${String(e).slice(0, 150)}`);
  }

  // 5) 'ready' incompletas y quietas: el onFailure las respeta a propósito —
  // nadie las rellenaba después. runPathGeneration es idempotente y resume.
  try {
    const incompletas = await db
      .select({ id: learningPaths.id })
      .from(learningPaths)
      .where(
        and(
          eq(learningPaths.status, "ready"),
          lt(learningPaths.generationProgress, 100),
          lt(learningPaths.updatedAt, sql`now() - interval '30 minutes'`),
          gt(learningPaths.createdAt, sql`now() - interval '48 hours'`),
        ),
      )
      .limit(10);
    for (const p of incompletas) {
      try {
        await enqueuePathGeneration(p.id);
        report.readyIncompletasReencoladas++;
      } catch (e) {
        report.errores.push(`ready ${p.id}: ${String(e).slice(0, 150)}`);
      }
    }
  } catch (e) {
    report.errores.push(`paso5: ${String(e).slice(0, 150)}`);
  }

  // 6) Outbox atascado: INSERT ok pero tasks.trigger murió (fila pending
  // eterna que el UNIQUE impide re-encolar), o failed tras 3 intentos.
  // attempts < 6 evita reintentar para siempre un correo permanentemente roto.
  try {
    if (env.TRIGGER_SECRET_KEY) {
      const atascados = await db
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(
          and(
            inArray(emailOutbox.status, ["pending", "failed"]),
            lt(emailOutbox.updatedAt, sql`now() - interval '10 minutes'`),
            lt(emailOutbox.attempts, 6),
          ),
        )
        .limit(20);
      if (atascados.length) {
        const { tasks } = await import("@trigger.dev/sdk");
        for (const row of atascados) {
          try {
            await tasks.trigger("send-progress-email", { outboxId: row.id });
            // Bump para no re-disparar el mismo correo cada 5 min mientras procesa.
            await db
              .update(emailOutbox)
              .set({ updatedAt: new Date() })
              .where(eq(emailOutbox.id, row.id));
            report.outboxReintentados++;
          } catch (e) {
            report.errores.push(`outbox ${row.id}: ${String(e).slice(0, 150)}`);
            break; // Trigger caído: no insistir con los demás en este ciclo
          }
        }
      }
    }
  } catch (e) {
    report.errores.push(`paso6: ${String(e).slice(0, 150)}`);
  }

  const total =
    report.paidSinRuta +
    report.webhooksPerdidosConfirmados +
    report.proWebhooksPerdidosConfirmados +
    report.draftsReencoladas +
    report.generandoReencoladas +
    report.generandoAFailed +
    report.generandoExpiradas48h +
    report.readyIncompletasReencoladas +
    report.outboxReintentados;
  if (total > 0 || report.errores.length > 0) {
    console.log("[reconcile]", JSON.stringify(report));
  }
  return report;
}
