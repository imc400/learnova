import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Mic, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  learningPaths,
  routeAgents,
  liveSessions,
  progress,
  modules,
  lessons,
} from "@/db/schema";
import { getEntitlement, proPeriodWindow } from "@/lib/subscription";
import { startClassAction } from "@/server/actions/live";
import { SubmitButton } from "@/components/app/submit-button";
import { PageHeader } from "@/components/app/brand/page-header";
import { EmptyState } from "@/components/app/brand/empty-state";
import { NotaBanner } from "@/components/app/brand/nota-banner";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";

export const metadata = { title: "Tus profesores" };
export const dynamic = "force-dynamic";

/*
  TUS PROFESORES: un profesor por ruta, con su cara, su especialidad y el
  cupo de minutos de clase. Pro puede tomar clases extra con cualquiera;
  Básico agotado el cupo de su ruta ve el upsell.
*/

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  // Formato es-CL corto de marca: "10 jun".
  return d
    .toLocaleDateString("es-CL", { day: "numeric", month: "short" })
    .replace(/\./g, "");
}

export default async function ProfesoresPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const paths = await db
    .select({
      id: learningPaths.id,
      title: learningPaths.title,
      cacheKey: learningPaths.skeletonCacheKey,
      status: learningPaths.status,
    })
    .from(learningPaths)
    .where(eq(learningPaths.userId, user.id))
    .orderBy(desc(learningPaths.createdAt));
  const ready = paths.filter((p) => p.status === "ready");

  // Profesores por cacheKey (1 por ruta canónica).
  const keys = [...new Set(ready.map((p) => p.cacheKey ?? `path-${p.id}`))];
  const agents = keys.length
    ? await db
        .select({
          cacheKey: routeAgents.cacheKey,
          name: routeAgents.name,
          specialty: routeAgents.specialty,
          style: routeAgents.style,
        })
        .from(routeAgents)
        .where(inArray(routeAgents.cacheKey, keys))
    : [];
  const agentByKey = new Map(agents.map((a) => [a.cacheKey, a]));

  // Minutos usados por ruta — MISMA matemática que usedClassMinutes en el
  // servidor (kind='class': la inducción va fuera del cupo; in_progress
  // cuenta por tiempo transcurrido): la UI muestra el saldo que se aplica.
  const pathIds = ready.map((p) => p.id);
  const usedMinutesExpr = sql<number>`ceil((
    coalesce(sum(${liveSessions.durationSec}) filter (where ${liveSessions.status} in ('completed', 'missed')), 0)
    + coalesce(sum(least(extract(epoch from now() - ${liveSessions.startedAt}), 1800)) filter (where ${liveSessions.status} = 'in_progress'), 0)
  ) / 60.0)::int`;
  const usage = pathIds.length
    ? await db
        .select({
          pathId: liveSessions.pathId,
          min: usedMinutesExpr,
        })
        .from(liveSessions)
        .where(
          and(
            inArray(liveSessions.pathId, pathIds),
            eq(liveSessions.kind, "class"),
          ),
        )
        .groupBy(liveSessions.pathId)
    : [];
  const usedByPath = new Map(usage.map((u) => [u.pathId, Number(u.min)]));

  // Avance por ruta (la clase del viaje se desbloquea al 40% — misma regla
  // que aplica el servidor en startClassAction).
  const prog = pathIds.length
    ? await db
        .select({
          pathId: progress.pathId,
          done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
        })
        .from(progress)
        .where(
          and(eq(progress.userId, user.id), inArray(progress.pathId, pathIds)),
        )
        .groupBy(progress.pathId)
    : [];
  const doneByPath = new Map(prog.map((r) => [r.pathId, Number(r.done)]));
  const totals = pathIds.length
    ? await db
        .select({
          pathId: modules.pathId,
          total: sql<number>`count(${lessons.id})::int`,
        })
        .from(modules)
        .innerJoin(lessons, sql`${lessons.moduleId} = ${modules.id}`)
        .where(inArray(modules.pathId, pathIds))
        .groupBy(modules.pathId)
    : [];
  const totalByPath = new Map(totals.map((r) => [r.pathId, Number(r.total)]));

  const { isPro } = await getEntitlement(user.id);

  // Ventana del pool Pro: UNA sola fuente de verdad (proPeriodWindow) — la
  // misma que aplica startClassAction. La UI jamás muestra un saldo distinto
  // al que el servidor descuenta.
  const { start: periodStart, end: periodEnd } = isPro
    ? await proPeriodWindow(user.id)
    : { start: new Date(0), end: null };

  const [monthRow] = isPro
    ? await db
        .select({ min: usedMinutesExpr })
        .from(liveSessions)
        .where(
          and(
            eq(liveSessions.userId, user.id),
            eq(liveSessions.kind, "class"),
            sql`${liveSessions.createdAt} >= ${periodStart}`,
          ),
        )
    : [];
  const proMonthLeft = isPro
    ? Math.max(0, env.PRO_MONTHLY_CLASS_MINUTES - Number(monthRow?.min ?? 0))
    : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        nota="te conocen ✺"
        titulo={
          <>
            Tus <span className="ink-hl">profesores</span>
          </>
        }
        subtitulo="Un profesor IA por voz para cada ruta — con memoria de tu avance, tus trabas y tus tareas."
      />

      {isPro && (
        <NotaBanner tone="aviso" className="mb-6">
          Pro: te quedan {proMonthLeft} de tus {env.PRO_MONTHLY_CLASS_MINUTES}{" "}
          minutos al mes de clases en vivo, con todos tus profesores.
        </NotaBanner>
      )}

      {ready.length === 0 ? (
        <EmptyState
          nota="tu primer profesor viene en camino ✺"
          titulo="Tu primer profesor llega con tu primera ruta"
          descripcion="Cada ruta viene con su profesor IA por voz: te conoce, recuerda tu avance y te deja tareas."
          cta={{ href: "/app/crear", label: "Diseñar mi ruta" }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {ready.map((p) => {
            const agent = agentByKey.get(p.cacheKey ?? `path-${p.id}`);
            const used = usedByPath.get(p.id) ?? 0;
            const routeLeft = Math.max(0, env.CLASS_MINUTES_PER_ROUTE - used);
            const total = totalByPath.get(p.id) ?? 0;
            const pct = total > 0 ? Math.round(((doneByPath.get(p.id) ?? 0) / total) * 100) : 0;
            // BÁSICO: solo la clase del VIAJE (≥40% de avance) y con cupo de
            // ruta. PRO: libre mientras tenga minutos (ruta o pool mensual).
            const canClass = isPro
              ? routeLeft > 0 || proMonthLeft > 0
              : pct >= 40 && routeLeft > 0;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 font-display text-lg font-bold text-primary">
                    {(agent?.name ?? "P").replace("Profe ", "").charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold">
                      {agent?.name ?? "Tu profesor"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {agent?.specialty ?? p.title}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                  Ruta: {p.title} · {pct}% completada
                </p>
                {canClass ? (
                  <>
                    {/* Ambos cupos a la vista: el de la ruta y el pool Pro. */}
                    <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                      {isPro
                        ? `${routeLeft} min en esta ruta · ${proMonthLeft} min de tu pool Pro del mes`
                        : `${routeLeft} min de clase disponibles en esta ruta`}
                    </p>
                    <form action={startClassAction.bind(null, p.id, "class")} className="mt-3">
                      <SubmitButton size="sm" className="w-full" pendingText="Preparando…">
                        <Mic className="size-4" /> Clase en vivo
                      </SubmitButton>
                    </form>
                  </>
                ) : isPro ? (
                  /* Pro sin minutos: nada que vender — fecha real de renovación. */
                  <div className="mt-3 rounded-lg border-2 border-dashed border-border bg-card/60 p-3 text-center">
                    <p className="text-xs font-medium">
                      Usaste tus {env.PRO_MONTHLY_CLASS_MINUTES} minutos del mes —
                      se renuevan el {periodEnd ? fmtDate(periodEnd) : "próximo período"}.
                    </p>
                  </div>
                ) : pct < 40 ? (
                  /* Ficha punteada: la clase aún no se gana. */
                  <div className="mt-3 rounded-lg border-2 border-dashed border-border bg-card/60 p-3 text-center">
                    <p className="hand inline-block rotate-[-1deg]">se desbloquea contigo ✺</p>
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-medium">
                      <Lock className="size-3.5" /> Tu clase del viaje se abre al
                      40% de avance — vas en {pct}%.
                    </p>
                  </div>
                ) : (
                  /* Básico con cupo de ruta agotado: upsell honesto a Pro. */
                  <div className="mt-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-center">
                    <p className="flex items-center justify-center gap-1.5 text-xs font-medium">
                      <Lock className="size-3.5" /> Más clases con tu profesor:
                    </p>
                    <Button
                      asChild
                      size="sm"
                      className="mt-2 h-auto min-h-11 whitespace-normal py-2"
                    >
                      <Link href="/app/planes">
                        Pro: {env.PRO_MONTHLY_CLASS_MINUTES} minutos al mes de
                        clases en vivo, con todos tus profesores
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
