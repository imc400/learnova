import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ChevronRight,
  Clock,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Trophy,
} from "lucide-react";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { moduleRatings } from "@/db/schema";
import { getPathTree } from "@/server/queries/paths";
import { GeneratingState } from "@/components/app/generating-state";
import { RouteProgressLive } from "@/components/app/route-progress-live";
import { LearningProgress } from "@/components/app/learning-progress";
import { NextStepCard } from "@/components/app/next-step-card";
import { ModuleRating } from "@/components/app/module-rating";
import { Badge } from "@/components/ui/badge";

export default async function PathPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const path = await getPathTree(pathId, user.id);
  if (!path) notFound();

  // Ratings existentes del usuario en esta ruta (badge junto a ✓ Completado).
  const myRatings = await db
    .select({ moduleId: moduleRatings.moduleId, rating: moduleRatings.rating })
    .from(moduleRatings)
    .where(and(eq(moduleRatings.userId, user.id), eq(moduleRatings.pathId, pathId)));
  const ratingByModule = new Map(myRatings.map((r) => [r.moduleId, r.rating]));

  if (path.status === "generating") {
    return (
      <div className="mx-auto max-w-2xl">
        <GeneratingState
          pathId={path.id}
          initialProgress={path.generationProgress}
          initialStep={path.generationStep ?? "Iniciando…"}
          totalLessons={path.totalLessons ?? null}
          generationStartedAt={
            path.generationStartedAt
              ? path.generationStartedAt.toISOString()
              : null
          }
        />
      </div>
    );
  }

  if (path.status === "failed") {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-destructive" />
        <h2 className="mt-4 font-display text-lg font-semibold">
          No pudimos generar esta ruta
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ocurrió un error durante la generación. Intenta crear la ruta de nuevo.
        </p>
        <Link href="/app/crear" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          Crear otra ruta
        </Link>
      </div>
    );
  }

  const totalLessons = path.modules.reduce((n, m) => n + m.lessons.length, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground">
        ← Mis rutas
      </Link>
      <div className="mt-3">
        <Badge variant="primary" className="capitalize">{path.level}</Badge>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
          {path.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{path.goal}</p>
        <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <PlayCircle className="size-4" /> {totalLessons} lecciones
          </span>
          {path.estimatedHours ? (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" /> ~{Math.round(path.estimatedHours)} h
            </span>
          ) : null}
        </div>
      </div>

      {path.generationProgress < 100 && (
        <RouteProgressLive
          pathId={path.id}
          initialProgress={path.generationProgress}
          totalLessons={path.totalLessons ?? totalLessons}
        />
      )}

      {/* Avance REAL del usuario (lecciones completadas) */}
      {path.lessonCount > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Tu avance</h2>
            {path.completedLessons === path.lessonCount && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <Trophy className="size-4" /> ¡Ruta completada!
              </span>
            )}
          </div>
          <LearningProgress
            done={path.completedLessons}
            total={path.lessonCount}
            className="mt-2"
          />
        </div>
      )}

      {/* Siguiente paso: SOLO al 100% (el pico motivacional, no antes) */}
      {path.lessonCount > 0 && path.completedLessons === path.lessonCount && (
        <NextStepCard
          pathId={path.id}
          userId={user.id}
          moduleTitles={path.modules.map((m) => m.title)}
        />
      )}

      <div className="mt-8 space-y-6">
        {path.modules.map((m, mi) => {
          const remaining = m.lessons.length - m.completedCount;
          return (
            <section key={m.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-sm font-semibold text-primary">
                  Módulo {mi + 1}
                </span>
                {m.lessons.length > 0 && (
                  <span className="flex items-center gap-3">
                    {remaining === 0 && (
                      <ModuleRating
                        moduleId={m.id}
                        variant="badge"
                        initialRating={
                          (ratingByModule.get(m.id) as "up" | "down" | undefined) ?? null
                        }
                      />
                    )}
                    <span
                      className={`text-xs tabular-nums ${
                        remaining === 0
                          ? "font-semibold text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      {remaining === 0
                        ? "✓ Completado"
                        : `${m.completedCount}/${m.lessons.length}`}
                    </span>
                  </span>
                )}
              </div>
              <h2 className="mt-1 font-display text-lg font-semibold">{m.title}</h2>
              {m.objective && (
                <p className="mt-1 text-sm text-muted-foreground">{m.objective}</p>
              )}
              {remaining === 1 && m.completedCount > 0 && (
                <p className="mt-1.5 text-sm font-medium text-accent-foreground">
                  🔥 Te falta solo 1 lección para cerrar este módulo.
                </p>
              )}
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {m.lessons.map((l, li) => (
                  <li key={l.id}>
                    <Link
                      href={`/app/rutas/${path.id}/leccion/${l.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted"
                    >
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs ${
                          l.completed
                            ? "border-primary bg-primary text-primary-foreground"
                            : l.content
                              ? "border-border text-muted-foreground"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {l.completed ? (
                          <CheckCircle2 className="size-4" />
                        ) : l.content ? (
                          <span className="tabular-nums">{li + 1}</span>
                        ) : (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                      </span>
                      <span
                        className={`flex-1 text-sm font-medium ${
                          l.completed ? "text-muted-foreground" : ""
                        }`}
                      >
                        {l.title}
                      </span>
                      {l.estimatedMinutes ? (
                        <span className="text-xs text-muted-foreground">
                          {l.estimatedMinutes} min
                        </span>
                      ) : null}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
