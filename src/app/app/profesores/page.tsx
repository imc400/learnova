import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { GraduationCap, Mic, Sparkles, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths, routeAgents, liveSessions } from "@/db/schema";
import { getEntitlement } from "@/lib/subscription";
import { startClassAction } from "@/server/actions/live";
import { SubmitButton } from "@/components/app/submit-button";
import { env } from "@/lib/env";

export const metadata = { title: "Tus profesores" };
export const dynamic = "force-dynamic";

/*
  TUS PROFESORES: un profesor por ruta, con su cara, su especialidad y el
  cupo de minutos de clase. Pro puede tomar clases extra con cualquiera;
  Básico agotado el cupo de su ruta ve el upsell.
*/

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

  // Minutos usados por ruta (todas las sesiones cuentan al pool de la ruta).
  const pathIds = ready.map((p) => p.id);
  const usage = pathIds.length
    ? await db
        .select({
          pathId: liveSessions.pathId,
          min: sql<number>`ceil(coalesce(sum(${liveSessions.durationSec}), 0) / 60.0)::int`,
        })
        .from(liveSessions)
        .where(
          inArray(liveSessions.pathId, pathIds),
        )
        .groupBy(liveSessions.pathId)
    : [];
  const usedByPath = new Map(usage.map((u) => [u.pathId, Number(u.min)]));

  const { isPro } = await getEntitlement(user.id);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [monthRow] = isPro
    ? await db
        .select({
          min: sql<number>`ceil(coalesce(sum(${liveSessions.durationSec}), 0) / 60.0)::int`,
        })
        .from(liveSessions)
        .where(
          sql`${liveSessions.userId} = ${user.id} and ${liveSessions.createdAt} >= ${monthStart}`,
        )
    : [];
  const proMonthLeft = isPro
    ? Math.max(0, env.PRO_MONTHLY_CLASS_MINUTES - Number(monthRow?.min ?? 0))
    : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Tus profesores
        </h1>
        <span className="tab-note">te conocen ✺</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Un profesor particular por ruta — con memoria de tu avance, tus trabas
        y tus tareas.
      </p>

      {isPro && (
        <p className="mt-4 rounded-md bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary">
          ⭐ Pro: te quedan {proMonthLeft} min de clases extra este mes, con
          cualquiera de tus profesores.
        </p>
      )}

      {ready.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <GraduationCap className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            Tu primer profesor llega con tu primera ruta.
          </p>
          <Link
            href="/app/crear"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles className="size-4" /> Crear mi ruta
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {ready.map((p) => {
            const agent = agentByKey.get(p.cacheKey ?? `path-${p.id}`);
            const used = usedByPath.get(p.id) ?? 0;
            const routeLeft = Math.max(0, env.CLASS_MINUTES_PER_ROUTE - used);
            const canClass = routeLeft > 0 || (isPro && proMonthLeft > 0);
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 font-display text-lg font-bold text-primary">
                    {(agent?.name ?? "P").replace("Profe ", "").charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-semibold">
                      {agent?.name ?? "Tu profesor"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {agent?.specialty ?? p.title}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                  Ruta: {p.title}
                </p>
                <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                  {routeLeft > 0
                    ? `${routeLeft} min de clase disponibles en esta ruta`
                    : isPro && proMonthLeft > 0
                      ? "Cupo de la ruta usado — corre por tu pool Pro"
                      : "Cupo de clases de esta ruta completo"}
                </p>
                {canClass ? (
                  <form action={startClassAction.bind(null, p.id, "class")} className="mt-3">
                    <SubmitButton size="sm" className="w-full" pendingText="Preparando…">
                      <Mic className="size-4" /> Clase en vivo
                    </SubmitButton>
                  </form>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-center">
                    <p className="flex items-center justify-center gap-1.5 text-xs font-medium">
                      <Lock className="size-3.5" /> Más clases con tu profesor:
                    </p>
                    <Link
                      href="/app/planes"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                    >
                      <Sparkles className="size-3.5" /> Hacerme Pro
                    </Link>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      o clase suelta ${env.PRICE_CLASS_CLP.toLocaleString("es-CL")} — muy pronto
                    </p>
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
