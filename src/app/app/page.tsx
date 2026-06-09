import Link from "next/link";
import {
  ArrowRight,
  Plus,
  Sparkles,
  Trophy,
  Flame,
  Footprints,
  Flag,
  Brain,
  Medal,
  Compass,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listUserPaths } from "@/server/queries/paths";
import { getUserAchievements } from "@/server/queries/gamification";
import { LearningProgress } from "@/components/app/learning-progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { pathStatus } from "@/db/schema";

export const metadata = { title: "Mis rutas" };

const STATUS: Record<
  (typeof pathStatus.enumValues)[number],
  { label: string; variant: "default" | "primary" | "accent" | "outline" }
> = {
  draft: { label: "Borrador", variant: "outline" },
  generating: { label: "Generando…", variant: "accent" },
  ready: { label: "Lista", variant: "primary" },
  failed: { label: "Falló", variant: "default" },
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

  // Solo se cuentan/muestran los visibles: deterministas + sorpresas YA ganadas.
  const visibleAchievements = achievements.filter(
    (a) => a.kind === "deterministic" || a.unlockedAt,
  );
  const unlocked = visibleAchievements.filter((a) => a.unlockedAt);
  const hasHiddenSurprises = achievements.some(
    (a) => a.kind === "surprise" && !a.unlockedAt,
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Mis rutas
          </h1>
          <p className="text-sm text-muted-foreground">
            Tus caminos de aprendizaje a medida.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/crear">
            <Plus className="size-4" /> Crear ruta
          </Link>
        </Button>
      </div>

      {paths.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
          <Sparkles className="size-8 text-primary" />
          <h2 className="mt-4 font-display text-lg font-semibold">
            Aún no tienes rutas
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Dinos qué quieres aprender y la IA te arma una ruta completa a tu medida.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app/crear">
              Crear mi primera ruta <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paths.map((p) => {
            const s = STATUS[p.status];
            const remaining = p.lessonCount - p.completedLessons;
            return (
              <Link
                key={p.id}
                href={`/app/rutas/${p.id}`}
                className="group flex flex-col rounded-lg border border-border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display font-semibold leading-tight">
                    {p.title}
                  </h3>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {p.goal}
                </p>
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
              </Link>
            );
          })}
        </div>
      )}

      {/* Logros */}
      {paths.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Logros
          </h2>
          <p className="text-sm text-muted-foreground">
            {unlocked.length} de {visibleAchievements.length} desbloqueados
            {hasHiddenSurprises && " · hay logros secretos por descubrir 🤫"}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {visibleAchievements
              .map((a) => {
                const Icon = ACHIEVEMENT_ICONS[a.icon] ?? Trophy;
                const isUnlocked = !!a.unlockedAt;
                return (
                  <div
                    key={a.id}
                    title={`${a.description}${a.xpReward ? ` · +${a.xpReward} XP` : ""}`}
                    className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors ${
                      isUnlocked
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground opacity-60"
                    }`}
                  >
                    <Icon className="size-4" />
                    <span className="font-medium">{a.title}</span>
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
