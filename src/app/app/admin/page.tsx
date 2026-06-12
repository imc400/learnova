import {
  Users,
  Map,
  CheckCircle2,
  GraduationCap,
  ShoppingCart,
  Banknote,
  Siren,
  Activity,
  Youtube,
  RefreshCcw,
} from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { formatPrice } from "@/lib/utils";
import {
  getAdminKpis,
  getFunnel,
  getDailySeries,
  getAdminUsers,
  getAbandonedCarts,
  getAdminPaths,
  getOpenIncidents,
  getAiCostSummary,
  getQuotaSummary,
  getProblemPaths,
  getPaidIntentsWithoutPath,
  getContinuationKpis,
  getProBySource,
  getLiveNow,
  getRecentClasses,
  getTodayPulse,
} from "@/server/queries/admin";
import {
  adminReplayPathAction,
  adminRunReconcileFormAction,
  resolveIncidentAction,
} from "@/server/actions/ops";
import { SubmitButton } from "@/components/app/submit-button";

// El template del root layout ya agrega "· Aulia".
export const metadata = { title: "Admin" };
// Métricas siempre frescas (es la sala de control del negocio).
export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Link wa.me listo para abrir conversación de remarketing. */
function waHref(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  // Celular chileno sin código de país ("9XXXXXXXX") → anteponer 56.
  if (digits.length === 9 && digits.startsWith("9")) digits = `56${digits}`;
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

export default async function AdminPage() {
  await requireAdmin();

  const [kpis, funnel, series, users, abandoned, paths] = await Promise.all([
    getAdminKpis(),
    getFunnel(),
    getDailySeries(),
    getAdminUsers(),
    getAbandonedCarts(),
    getAdminPaths(),
  ]);
  // Salud operativa por separado: si las tablas de ops aún no existen
  // (migración pendiente), el resto de la sala de control sigue funcionando.
  const [incidents, aiCost, quota, problemPaths, paidSinRuta, continuation, proSources] =
    await Promise.all([
      getOpenIncidents().catch(() => []),
      getAiCostSummary().catch(() => null),
      getQuotaSummary().catch(() => null),
      getProblemPaths().catch(() => []),
      getPaidIntentsWithoutPath().catch(() => []),
      getContinuationKpis().catch(() => null),
      getProBySource().catch(() => []),
    ]);
  // Pulso en vivo (pedido del fundador: ver QUIÉN está en clase y qué pasó hoy).
  const [liveNow, recentClasses, pulse] = await Promise.all([
    getLiveNow().catch(() => []),
    getRecentClasses().catch(() => []),
    getTodayPulse().catch(() => null),
  ]);

  const kpiCards = [
    { icon: Users, label: "Usuarios", value: kpis.usersTotal, sub: `+${kpis.users7d} esta semana` },
    { icon: Map, label: "Rutas creadas", value: kpis.pathsTotal, sub: `+${kpis.paths7d} esta semana` },
    { icon: CheckCircle2, label: "Activación", value: `${kpis.activationPct}%`, sub: `${kpis.lessonsCompleted} lecciones completadas` },
    { icon: GraduationCap, label: "Clases en vivo", value: kpis.liveClasses, sub: `${kpis.liveMinutes} min hablados` },
    { icon: ShoppingCart, label: "Checkout", value: kpis.intentsTotal ? `${kpis.intentsPaid}/${kpis.intentsTotal}` : "—", sub: kpis.intentsPending ? `${kpis.intentsPending} carros abandonados` : "paywall sin tráfico aún" },
    { icon: Banknote, label: "Ingresos", value: formatPrice(kpis.revenueClp, "CLP"), sub: "CLP confirmados (pagos acreditados)" },
  ];

  const maxFunnel = Math.max(...funnel.map((f) => f.count), 1);
  const maxDay = Math.max(...series.map((d) => Math.max(d.signups, d.paths)), 1);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Sala de control
        </h1>
        <span className="tab-note">números reales ✺</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Todo lo que pasa en Aulia, en números accionables. Se actualiza en cada carga.
      </p>

      {/* Incidentes abiertos (alertFounder los registra; banner rojo) */}
      {incidents.length > 0 && (
        <section className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-destructive">
            <Siren className="size-4" /> Incidentes abiertos ({incidents.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {incidents.map((inc) => (
              <li
                key={inc.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-card p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        inc.severity === "critical"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-accent/30 text-accent-foreground"
                      }`}
                    >
                      {inc.severity}
                    </span>
                    {inc.title}
                  </p>
                  {inc.detail && (
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                      {inc.detail}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">{fmtDate(inc.createdAt)}</p>
                </div>
                <form action={resolveIncidentAction}>
                  <input type="hidden" name="incidentId" value={inc.id} />
                  <SubmitButton variant="outline" size="sm" pendingText="…">
                    Resolver
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {kpiCards.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <k.icon className="size-3.5" /> {k.label}
            </p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums">{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* EN EL AULA AHORA: quién está hablando con su profesor en este momento */}
      {liveNow.length > 0 && (
        <section className="mt-6 rounded-xl border-2 border-primary/50 bg-primary/5 p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            En el aula AHORA ({liveNow.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {liveNow.map((s) => (
              <li
                key={s.sessionId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-card p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.name ?? s.email ?? "—"}{" "}
                    <span className="text-xs text-muted-foreground">({s.email ?? "sin correo"})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.kind === "induction" ? "Clase de bienvenida" : "Clase completa"}
                    {s.teacher ? ` con ${s.teacher}` : ""} · {s.pathTitle}
                  </p>
                </div>
                <span className="font-display text-lg font-bold tabular-nums text-primary">
                  {s.elapsedMin} min
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PULSO DE HOY: el día en una mirada (hora Chile) */}
      {pulse && (
        <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Activity className="size-4 text-primary" /> Pulso de hoy
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Registros", value: pulse.signupsToday },
              { label: "Rutas creadas", value: pulse.pathsToday },
              { label: "Lecciones completadas", value: pulse.lessonsToday },
              { label: "Usuarios estudiando", value: pulse.activeUsersToday },
              { label: "Clases en vivo", value: pulse.classesToday },
              { label: "Min hablados", value: pulse.classMinutesToday },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-card p-3">
                <p className="font-display text-xl font-bold tabular-nums">{m.value}</p>
                <p className="text-[11px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
          {pulse.topToday.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Más activos hoy
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {pulse.topToday.map((t) => (
                  <li
                    key={t.email ?? "?"}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs"
                  >
                    {t.email ?? "—"} · <strong className="tabular-nums">{t.lessons}</strong>{" "}
                    {t.lessons === 1 ? "lección" : "lecciones"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Últimas clases: duración real + si el resumen llegó */}
      {recentClasses.length > 0 && (
        <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <GraduationCap className="size-4 text-primary" /> Últimas clases
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3">Cuándo</th>
                  <th className="py-1.5 pr-3">Alumno</th>
                  <th className="py-1.5 pr-3">Ruta · profesor</th>
                  <th className="py-1.5 pr-3">Tipo</th>
                  <th className="py-1.5 pr-3 text-right">Min</th>
                  <th className="py-1.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {recentClasses.map((c) => (
                  <tr key={c.sessionId} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                      {c.endedAt ? fmtDate(c.endedAt) : "—"}
                    </td>
                    <td className="max-w-[180px] truncate py-1.5 pr-3">{c.email ?? "—"}</td>
                    <td className="max-w-[240px] truncate py-1.5 pr-3 text-xs">
                      {c.pathTitle}
                      {c.teacher ? ` · ${c.teacher}` : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-xs">
                      {c.kind === "induction" ? "Bienvenida" : "Clase"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.durationMin}</td>
                    <td className="py-1.5 text-xs">
                      {c.status === "completed" ? (
                        <span className="text-primary">completada{c.hasSummary ? " · resumen ✓" : ""}</span>
                      ) : (
                        <span className="text-muted-foreground">se cortó (barrida)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Salud operativa: cuota YouTube + costo IA + reconciliación a demanda */}
      <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Activity className="size-4 text-primary" /> Salud operativa
          </h2>
          <form action={adminRunReconcileFormAction}>
            <SubmitButton variant="outline" size="sm" pendingText="Reconciliando…">
              <RefreshCcw className="size-3.5" /> Correr reconciliación ahora
            </SubmitButton>
          </form>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Youtube className="size-3.5" /> Cuota YouTube hoy
            </p>
            {quota ? (
              <>
                <p className="mt-1.5 font-display text-xl font-bold tabular-nums">
                  {quota.youtubeUnits.toLocaleString("es-CL")}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {quota.youtubeDailyLimit.toLocaleString("es-CL")} u.
                  </span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      quota.youtubeUnits >= quota.youtubeSoftLimit
                        ? "bg-destructive"
                        : quota.youtubeUnits >= quota.youtubeDailyLimit * 0.8
                          ? "bg-accent"
                          : "bg-primary"
                    }`}
                    style={{
                      width: `${Math.min(100, (quota.youtubeUnits / quota.youtubeDailyLimit) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  breaker en {quota.youtubeSoftLimit.toLocaleString("es-CL")} ·{" "}
                  {quota.backfillPending} lecciones en backfill · Gemini{" "}
                  {quota.geminiRequests} req · resetea 00:00 PT
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">sin datos (¿migración pendiente?)</p>
            )}
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Costo IA hoy (Anthropic)
            </p>
            {aiCost ? (
              <>
                <p className="mt-1.5 font-display text-xl font-bold tabular-nums">
                  US$ {aiCost.costTodayUsd.toFixed(2)}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {aiCost.callsToday} llamadas · cache-hit {aiCost.cacheHitPct}% — si se
                  dispara, kill-switch env <code>AI_DISABLED=true</code>
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">
                sin datos aún (lo puebla el wrapper de Track A)
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Costo por ruta (14 días)
            </p>
            {aiCost ? (
              <>
                <p className="mt-1.5 font-display text-xl font-bold tabular-nums">
                  p50 US$ {aiCost.costPerPathP50Usd.toFixed(2)}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  p95 US$ {aiCost.costPerPathP95Usd.toFixed(2)} — fresca vs cacheada, ya
                  no es fe
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">sin datos aún</p>
            )}
          </div>
        </div>
      </section>

      {/* Pagados sin ruta: el incidente que NO puede esperar */}
      {paidSinRuta.length > 0 && (
        <section className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-destructive">
            <Banknote className="size-4" /> Pagados SIN ruta ({paidSinRuta.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Plata cobrada sin producto. La reconciliación los repara cada 5 min — si uno
            persiste aquí, usar el botón de arriba y revisar Trigger.dev.
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {paidSinRuta.map((i) => (
                <tr key={i.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium capitalize">{i.topic}</td>
                  <td className="py-2 pr-3 text-xs">{i.email ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs tabular-nums">
                    {i.amountClp ? formatPrice(i.amountClp, "CLP") : "—"}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {i.paidAt ? fmtDate(i.paidAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Generaciones con problemas + replay por fila (E-P1.3) */}
      {problemPaths.length > 0 && (
        <section className="mt-6 rounded-xl border border-accent bg-accent/10 p-5">
          <h2 className="font-display text-base font-semibold">
            Generaciones con problemas ({problemPaths.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            failed, colgadas, draft viejas o ready incompletas (14 días). Replay re-encola:
            la generación es idempotente y resume desde el caché.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Ruta</th>
                  <th className="py-2 pr-3">Usuario</th>
                  <th className="py-2 pr-3">Problema</th>
                  <th className="py-2 pr-3 text-right">Generación</th>
                  <th className="py-2 pr-3">Cuándo</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {problemPaths.map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="max-w-56 truncate py-2 pr-3 font-medium">{p.title}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{p.email}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          p.problema === "falló"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {p.problema}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.generationProgress}%</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{fmtDate(p.createdAt)}</td>
                    <td className="py-2 text-right">
                      <form action={adminReplayPathAction}>
                        <input type="hidden" name="pathId" value={p.id} />
                        <SubmitButton variant="outline" size="sm" pendingText="Encolando…">
                          Replay
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Embudo */}
      <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-semibold">Embudo de conversión</h2>
        <div className="mt-4 space-y-2.5">
          {funnel.map((f, i) => {
            const prev = i > 0 ? funnel[i - 1]!.count : f.count;
            const pctOfPrev = prev > 0 ? Math.round((f.count / prev) * 100) : 0;
            return (
              <div key={f.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{f.label}</span>
                  <span className="tabular-nums font-semibold">
                    {f.count}
                    {i > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        ({pctOfPrev}% del paso anterior)
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(f.count / maxFunnel) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Atribución: funnel de continuación + Pro por source (columnas Track D) */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-semibold">Atribución de ingresos</h2>
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Siguiente paso (continuación)
            </p>
            {continuation ? (
              <>
                <p className="mt-1.5 text-sm">
                  <span className="font-display text-xl font-bold tabular-nums">
                    {continuation.sugerenciasEmitidas}
                  </span>{" "}
                  <span className="text-muted-foreground">sugerencias emitidas</span>
                </p>
                {continuation.porVia.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Aún sin intents de continuación.
                  </p>
                ) : (
                  <table className="mt-2 w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-1.5 pr-3">Vía</th>
                        <th className="py-1.5 pr-3 text-right">Intents</th>
                        <th className="py-1.5 text-right">Pagados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {continuation.porVia.map((v) => (
                        <tr key={v.via} className="border-b border-border/50">
                          <td className="py-1.5 pr-3 capitalize">{v.via}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{v.intents}</td>
                          <td className="py-1.5 text-right tabular-nums font-semibold">
                            {v.pagados}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">sin datos (¿migración pendiente?)</p>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Pro por CTA de origen
            </p>
            {proSources.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Aún sin compras Pro con atribución (la columna la puebla cada CTA).
              </p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {proSources.map((s) => (
                    <tr key={s.source} className="border-b border-border/50">
                      <td className="py-1.5 pr-3">{s.source}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold">{s.compras}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* Serie diaria */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-semibold">
          Últimos 14 días{" "}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            <span className="text-foreground/30">■</span> registros ·{" "}
            <span className="text-primary">■</span> rutas
          </span>
        </h2>
        <div className="mt-4 flex h-28 items-end gap-1.5">
          {series.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-0.5" title={`${d.day}: ${d.signups} registros, ${d.paths} rutas`}>
              <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                <div
                  className="w-1/3 rounded-t bg-foreground/30"
                  style={{ height: `${(d.signups / maxDay) * 100}%`, minHeight: d.signups ? 3 : 0 }}
                />
                <div
                  className="w-1/3 rounded-t bg-primary"
                  style={{ height: `${(d.paths / maxDay) * 100}%`, minHeight: d.paths ? 3 : 0 }}
                />
              </div>
              <span className="text-[9px] tabular-nums text-muted-foreground">
                {d.day.slice(8, 10)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Carros abandonados */}
      <section className="mt-6 rounded-xl border border-accent bg-accent/10 p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <ShoppingCart className="size-4 text-primary" /> Carros abandonados ({abandoned.length})
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Completaron el formulario pero no pagaron. Contacto directo para remarketing.
        </p>
        {abandoned.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Ninguno por ahora{kpis.intentsTotal === 0 ? " (el paywall aún no recibe tráfico)" : ""}.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Cuándo</th>
                  <th className="py-2 pr-3">Tema</th>
                  <th className="py-2 pr-3">Nombre</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2">WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {abandoned.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{fmtDate(a.createdAt)}</td>
                    <td className="py-2 pr-3 font-medium capitalize">{a.topic}</td>
                    <td className="py-2 pr-3">{a.name ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{a.email ?? "—"}</td>
                    <td className="py-2">
                      {waHref(a.phone) ? (
                        <a
                          href={waHref(a.phone)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {a.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Usuarios */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-semibold">Usuarios recientes</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Usuario</th>
                <th className="py-2 pr-3">WhatsApp</th>
                <th className="py-2 pr-3">Registro</th>
                <th className="py-2 pr-3 text-right">Rutas</th>
                <th className="py-2 pr-3 text-right">Lecciones</th>
                <th className="py-2 pr-3 text-right">Avance prom.</th>
                <th className="py-2 pr-3 text-right">XP</th>
                <th className="py-2">Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/50">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{u.name ?? "Sin nombre"}</span>
                    <span className="block text-xs text-muted-foreground">{u.email}</span>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {waHref(u.phone) ? (
                      <a href={waHref(u.phone)!} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {u.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{fmtDate(u.createdAt)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{u.paths}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{u.lessonsDone}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{u.avgProgressPct}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{u.totalXp}</td>
                  <td className="py-2 text-xs text-muted-foreground">{u.lastActiveDay ?? "nunca"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Rutas recientes */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-semibold">Rutas recientes</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Ruta</th>
                <th className="py-2 pr-3">Usuario</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3 text-right">Generación</th>
                <th className="py-2 text-right">Avance alumno</th>
              </tr>
            </thead>
            <tbody>
              {paths.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="max-w-56 truncate py-2 pr-3 font-medium">{p.title}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{p.email}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        p.status === "ready"
                          ? "bg-primary/10 text-primary"
                          : p.status === "failed"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.status === "ready"
                        ? "lista"
                        : p.status === "failed"
                          ? "falló"
                          : "generando"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.generationProgress}%</td>
                  <td className="py-2 text-right tabular-nums">{p.userPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
