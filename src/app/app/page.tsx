import type { CSSProperties } from "react";
import Link from "next/link";
import {
  Plus,
  Sparkles,
  Trophy,
  Flame,
  Footprints,
  Flag,
  Brain,
  Medal,
  Compass,
  Route,
  type LucideIcon,
} from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { pathPurchases, liveSessions } from "@/db/schema";
import { getEntitlement } from "@/lib/subscription";
import { formatPrice } from "@/lib/utils";
import { listUserPaths } from "@/server/queries/paths";
import { getUserAchievements } from "@/server/queries/gamification";
import { LearningProgress } from "@/components/app/learning-progress";
import { PageHeader } from "@/components/app/brand/page-header";
import { EmptyState } from "@/components/app/brand/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDoodle, Check as CheckMark } from "@/components/marketing/landing/icons";
import { env } from "@/lib/env";
import type { pathStatus } from "@/db/schema";

export const metadata = { title: "Mis rutas" };

const STATUS: Record<
  (typeof pathStatus.enumValues)[number],
  {
    label: string;
    variant: "default" | "primary" | "accent" | "outline";
    className?: string;
  }
> = {
  draft: { label: "Borrador", variant: "outline" },
  generating: { label: "Generando…", variant: "accent" },
  ready: { label: "Lista", variant: "primary" },
  // El lápiz rojo corrige, no se esconde: failed deja de ser kraft invisible.
  failed: { label: "Algo falló", variant: "default", className: "bg-destructive/10 text-destructive" },
};

// Mapa de íconos del catálogo de logros (achievements.icon → componente).
const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  footprints: Footprints,
  flag: Flag,
  trophy: Trophy,
  brain: Brain,
  sparkles: Sparkles,
  flame: Flame,
  medal: Medal,
  compass: Compass,
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [paths, achievements] = user
    ? await Promise.all([listUserPaths(user.id), getUserAchievements(user.id)])
    : [[], []];
  const { isPro } = user ? await getEntitlement(user.id) : { isPro: false };

  // Banner Pro CONDICIONADO a señales (permanente = ceguera de banner):
  // (a) 2+ rutas compradas sueltas → anclaje matemático honesto con SU gasto real;
  // (b) ya usó ≥50% del cupo de minutos de una ruta → probó las clases y le gustaron.
  // Sin señal, sin banner.
  let proBanner: { copy: string } | null = null;
  if (user && !isPro && paths.length > 0) {
    const [[buys], [mins]] = await Promise.all([
      db
        .select({
          n: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${pathPurchases.amount}), 0)::int`,
        })
        .from(pathPurchases)
        .where(
          and(
            eq(pathPurchases.userId, user.id),
            eq(pathPurchases.kind, "route"),
            eq(pathPurchases.status, "paid"),
          ),
        ),
      db
        .select({
          sec: sql<number>`coalesce(sum(${liveSessions.durationSec}) filter (where ${liveSessions.status} in ('completed', 'missed')), 0)::int`,
        })
        .from(liveSessions)
        .where(eq(liveSessions.userId, user.id)),
    ]);
    const paidRoutes = Number(buys?.n ?? 0);
    const invested = Number(buys?.total ?? 0);
    const usedMin = Math.ceil(Number(mins?.sec ?? 0) / 60);
    if (paidRoutes >= 2) {
      proBanner = {
        copy: `Ya invertiste ${formatPrice(invested, "CLP")} en ${paidRoutes} rutas — Pro te da ${env.PRO_ROUTES_PER_MONTH} al mes, más 120 minutos de clases en vivo, por ${formatPrice(env.PRICE_PRO_CLP, "CLP")}.`,
      };
    } else if (usedMin >= env.CLASS_MINUTES_PER_ROUTE / 2) {
      proBanner = {
        copy: `${env.PRO_ROUTES_PER_MONTH} rutas nuevas al mes + 120 minutos al mes de clases en vivo, con todos tus profesores.`,
      };
    }
  }

  // "Caminos": cadenas de rutas conectadas por linaje (sourcePathId — la ruta
  // creada desde el "Siguiente paso" de otra). Un camino = raíz + sucesoras.
  const pathIds = new Set(paths.map((p) => p.id));
  const childByParent = new Map<string, (typeof paths)[number]>();
  for (const p of paths) {
    if (p.sourcePathId && pathIds.has(p.sourcePathId)) {
      childByParent.set(p.sourcePathId, p);
    }
  }
  const inChain = new Set<string>();
  const chains: (typeof paths)[] = [];
  for (const p of paths) {
    const isRoot =
      (!p.sourcePathId || !pathIds.has(p.sourcePathId)) && childByParent.has(p.id);
    if (!isRoot) continue;
    const chain: typeof paths = [p];
    let cur = p;
    while (childByParent.has(cur.id)) {
      cur = childByParent.get(cur.id)!;
      chain.push(cur);
    }
    chains.push(chain);
    for (const c of chain) inChain.add(c.id);
  }
  const standalone = paths.filter((p) => !inChain.has(p.id));

  // Solo se cuentan/muestran los visibles: deterministas + sorpresas YA ganadas.
  const visibleAchievements = achievements.filter(
    (a) => a.kind === "deterministic" || a.unlockedAt,
  );
  const unlocked = visibleAchievements.filter((a) => a.unlockedAt);
  const porDesbloquear = visibleAchievements.length - unlocked.length;
  const hasHiddenSurprises = achievements.some(
    (a) => a.kind === "surprise" && !a.unlockedAt,
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          className="mb-0"
          nota="tu cuaderno ✺"
          titulo={
            <>
              Tus rutas, <span className="ink-hl">a tu medida</span>
            </>
          }
          subtitulo="Retoma donde quedaste. Tu avance mide dominio, no minutos."
        />
        <Button asChild className="mt-1">
          <Link href="/app/crear">
            <Plus className="size-4" /> Crear ruta
          </Link>
        </Button>
      </div>

      {/* Estímulo Pro condicionado a señales reales (gasto en rutas sueltas o
          uso de clases) — un banner permanente se vuelve invisible. */}
      {proBanner && (
        <div className="relative mt-2 flex flex-col items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <span className="absolute -top-4 right-5 rotate-[3deg]">
            <span className="tab-note">sin cobro automático ✺</span>
          </span>
          <div>
            <p className="font-display text-sm font-bold">¿Vas en serio? Aulia Pro</p>
            <p className="text-sm text-muted-foreground">{proBanner.copy}</p>
          </div>
          <Button asChild size="sm" variant="primary">
            <Link href="/app/planes?source=dashboard_banner">Conocer Pro</Link>
          </Button>
        </div>
      )}

      {paths.length === 0 ? (
        <EmptyState
          nota="tu cuaderno está en blanco ✺"
          titulo="Todavía no tienes rutas"
          descripcion="Dinos qué quieres aprender y la IA diseña una ruta solo para ti. Ves tu temario completo antes de pagar."
          cta={{ href: "/app/crear", label: "Diseñar mi ruta" }}
        />
      ) : (
        <>
        {/* Caminos: cadenas de rutas conectadas (creadas desde "Siguiente paso") */}
        {chains.length > 0 && (
          <section className="flex flex-col gap-4">
            {chains.map((chain) => {
              const last = chain[chain.length - 1]!;
              const chainDone =
                last.lessonCount > 0 && last.completedLessons === last.lessonCount;
              return (
              <div key={chain[0]!.id}>
                <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-primary">
                  <Route className="size-4" /> Camino de {chain[0]!.topic}
                  <span className="font-normal text-muted-foreground">
                    · {chain.length} rutas
                  </span>
                </h2>
                {/* Mobile: apilado vertical (flecha apunta abajo). Desktop:
                    fila con scroll y flecha girada hacia la derecha. */}
                <div className="mt-3 flex flex-col items-stretch gap-2 pb-1 sm:flex-row sm:overflow-x-auto">
                  {chain.map((p, i) => {
                    const done =
                      p.lessonCount > 0 && p.completedLessons === p.lessonCount;
                    return (
                      <div key={p.id} className="flex flex-col items-center gap-2 sm:flex-row">
                        <Link
                          href={`/app/rutas/${p.id}`}
                          className={`flex w-full shrink-0 flex-col rounded-lg border p-4 shadow-soft transition-shadow hover:shadow-lift sm:w-56 ${
                            done
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-card"
                          }`}
                        >
                          <span className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                            Etapa {i + 1}
                            {done && (
                              <Badge variant="accent" className="normal-case tracking-normal">
                                <CheckMark size={12} /> completada
                              </Badge>
                            )}
                          </span>
                          <span className="mt-1 line-clamp-2 font-display text-sm font-semibold leading-tight">
                            {p.title}
                          </span>
                          {p.lessonCount > 0 && (
                            <LearningProgress
                              done={p.completedLessons}
                              total={p.lessonCount}
                              size="sm"
                              showLabel={false}
                              className="mt-3"
                            />
                          )}
                        </Link>
                        {i < chain.length - 1 && (
                          <ArrowDoodle
                            size={28}
                            className="shrink-0 text-primary sm:-rotate-90"
                          />
                        )}
                      </div>
                    );
                  })}
                  {/* Camino completo → la siguiente etapa se planifica contigo */}
                  {chainDone && (
                    <div className="flex flex-col items-center gap-2 sm:flex-row">
                      <ArrowDoodle
                        size={28}
                        className="shrink-0 text-primary sm:-rotate-90"
                      />
                      <Link
                        href={`/app/rutas/${last.id}`}
                        className="flex w-full shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-card/60 p-4 text-center sm:w-56"
                      >
                        <span className="hand">
                          Etapa {chain.length + 1} · se diseñará contigo ✺
                        </span>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </section>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {standalone.map((p) => {
            const s = STATUS[p.status];
            const remaining = p.lessonCount - p.completedLessons;
            const cardBody = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display font-semibold leading-tight">
                    {p.title}
                  </h3>
                  <Badge variant={s.variant} className={s.className}>{s.label}</Badge>
                </div>
                {p.status === "failed" ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Algo falló al generar — escríbenos a hola@aulia.ai y lo
                    resolvemos.
                  </p>
                ) : (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {p.goal}
                  </p>
                )}
                {p.lessonCount > 0 && (
                  <LearningProgress
                    done={p.completedLessons}
                    total={p.lessonCount}
                    size="sm"
                    className="mt-4"
                  />
                )}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{p.level}</span>
                  {p.estimatedHours ? <span>· ~{Math.round(p.estimatedHours)} h</span> : null}
                  {p.completedLessons > 0 && remaining > 0 && remaining <= 3 && (
                    <span className="font-medium text-primary">
                      · ¡Te {remaining === 1 ? "falta 1 lección" : `faltan ${remaining} lecciones`}!
                    </span>
                  )}
                </div>
              </>
            );
            // Failed: card sin link (no hay lección a la que ir) + salida
            // accionable por correo. Los anchors no se pueden anidar.
            if (p.status === "failed") {
              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-lg border border-destructive/30 bg-card p-5 shadow-soft"
                >
                  {cardBody}
                  <Button asChild size="sm" variant="outline" className="mt-4 self-start">
                    <a href="mailto:hola@aulia.ai">Escríbenos y lo resolvemos</a>
                  </Button>
                </div>
              );
            }
            return (
              <Link
                key={p.id}
                href={`/app/rutas/${p.id}`}
                className="group flex flex-col rounded-lg border border-border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift"
              >
                {cardBody}
              </Link>
            );
          })}
        </div>
        </>
      )}

      {/* Logros */}
      {paths.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Logros
          </h2>
          <p className="text-sm text-muted-foreground">
            {porDesbloquear > 0
              ? `Hay ${porDesbloquear} ${porDesbloquear === 1 ? "logro" : "logros"} por desbloquear`
              : `${unlocked.length} de ${visibleAchievements.length} desbloqueados`}
            {hasHiddenSurprises && " · y hay secretos por descubrir"}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {visibleAchievements.map((a, i) => {
              const Icon = ACHIEVEMENT_ICONS[a.icon] ?? Trophy;
              const isUnlocked = !!a.unlockedAt;
              return (
                <div
                  key={a.id}
                  className={`max-w-72 items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                    isUnlocked
                      ? "sticker-pop border-accent/40 bg-highlight-soft"
                      : "flex border-border bg-card text-muted-foreground opacity-60"
                  }`}
                  style={
                    isUnlocked
                      ? ({ "--pop-rotate": i % 2 ? "2deg" : "-2deg" } as CSSProperties)
                      : undefined
                  }
                >
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight">{a.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {a.description}
                      {a.xpReward ? ` · +${a.xpReward} XP` : ""}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
