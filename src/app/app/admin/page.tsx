import {
  Users,
  Map,
  CheckCircle2,
  GraduationCap,
  ShoppingCart,
  Banknote,
} from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import {
  getAdminKpis,
  getFunnel,
  getDailySeries,
  getAdminUsers,
  getAbandonedCarts,
  getAdminPaths,
} from "@/server/queries/admin";

export const metadata = { title: "Admin · Aulia" };
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
  const digits = phone.replace(/\D/g, "");
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

  const kpiCards = [
    { icon: Users, label: "Usuarios", value: kpis.usersTotal, sub: `+${kpis.users7d} esta semana` },
    { icon: Map, label: "Rutas creadas", value: kpis.pathsTotal, sub: `+${kpis.paths7d} esta semana` },
    { icon: CheckCircle2, label: "Activación", value: `${kpis.activationPct}%`, sub: `${kpis.lessonsCompleted} lecciones completadas` },
    { icon: GraduationCap, label: "Clases en vivo", value: kpis.liveClasses, sub: `${kpis.liveMinutes} min hablados` },
    { icon: ShoppingCart, label: "Checkout", value: kpis.intentsTotal ? `${kpis.intentsPaid}/${kpis.intentsTotal}` : "—", sub: kpis.intentsPending ? `${kpis.intentsPending} carros abandonados` : "paywall sin tráfico aún" },
    { icon: Banknote, label: "Ingresos", value: `$${kpis.revenueClp.toLocaleString("es-CL")}`, sub: "CLP confirmados (pagos acreditados)" },
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

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {kpiCards.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <k.icon className="size-3.5" /> {k.label}
            </p>
            <p className="mt-1.5 font-display text-2xl font-bold tabular-nums">{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Embudo */}
      <section className="mt-8 rounded-xl border border-border bg-card p-5">
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

      {/* Serie diaria */}
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold">
          Últimos 14 días{" "}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ■ registros · <span className="text-primary">■</span> rutas
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
        <h2 className="font-display text-base font-semibold">
          🛒 Carros abandonados ({abandoned.length})
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
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
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
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
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
                      {p.status}
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
