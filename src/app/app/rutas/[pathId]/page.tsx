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
  Lock,
  Sparkles,
  GraduationCap,
} from "lucide-react";
import { and, asc, desc, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { moduleRatings, homeworkItems, liveSessions } from "@/db/schema";
import { getPathTree } from "@/server/queries/paths";
import { startClassAction, toggleHomeworkAction } from "@/server/actions/live";
import { SubmitButton } from "@/components/app/submit-button";
import { GeneratingState } from "@/components/app/generating-state";

/** % de avance que desbloquea la clase en vivo con el profesor IA. */
const CLASS_UNLOCK_PCT = 40;
import { RouteProgressLive } from "@/components/app/route-progress-live";
import { LearningProgress } from "@/components/app/learning-progress";
import { NextStepCard } from "@/components/app/next-step-card";
import { ModuleRating } from "@/components/app/module-rating";
import { Badge } from "@/components/ui/badge";

/** Mensajes amigables para errores al iniciar clase (vía ?clase_error=). */
const CLASS_ERRORS: Record<string, string> = {
  cupo: "Alcanzaste tu cupo de clases de esta semana. Vuelve la próxima — tu profesor te estará esperando.",
  voz: "No pudimos preparar la voz de tu profesor. Intenta de nuevo en unos minutos.",
  revision: "El profesor de esta ruta está en revisión. Intenta más tarde.",
  desactivadas: "Las clases en vivo están temporalmente desactivadas.",
  induccion_hecha:
    "Tu inducción ya está completa — esa conversación es una sola. Ahora toca avanzar: al 40% de la ruta se desbloquea tu clase particular.",
};

export default async function PathPage({
  params,
  searchParams,
}: {
  params: Promise<{ pathId: string }>;
  searchParams: Promise<{ clase?: string; clase_error?: string; induccion?: string }>;
}) {
  const { pathId } = await params;
  const sp = await searchParams;
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

  // Tareas asignadas por el profesor en clase (pendientes primero).
  const homework = await db
    .select()
    .from(homeworkItems)
    .where(and(eq(homeworkItems.userId, user.id), eq(homeworkItems.pathId, pathId)))
    .orderBy(asc(homeworkItems.done), desc(homeworkItems.createdAt))
    .limit(8);

  // ¿La inducción ya se hizo? Es única: hecha una vez, el CTA desaparece.
  const [inductionDone] = await db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.userId, user.id),
        eq(liveSessions.pathId, pathId),
        eq(liveSessions.kind, "induction"),
        eq(liveSessions.status, "completed"),
      ),
    )
    .limit(1);

  // Vigilante: una generación de >50 min está muerta (el job marca failed al
  // agotar reintentos, pero si ni eso corrió, la UI no gira para siempre).
  const generationStale =
    path.status === "generating" &&
    path.generationStartedAt &&
    Date.now() - path.generationStartedAt.getTime() > 50 * 60_000;

  if (path.status === "generating" && !generationStale) {
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

  if (path.status === "failed" || generationStale) {
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

      {/* Post-inducción: la conversación fue única — ahora a la ruta. */}
      {sp.induccion === "finalizada" && (
        <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-primary/40 bg-card text-primary">
              <GraduationCap className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-bold">
                ¡Inducción completada! 🎓
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ya conociste a tu profesor y tu ruta. Te llegará un correo con
                el resumen de la conversación. Ahora empieza lo bueno: tu
                primera lección te espera — y al {CLASS_UNLOCK_PCT}% de avance
                se desbloquea tu clase particular.
              </p>
              {path.modules[0]?.lessons[0] && (
                <Link
                  href={`/app/rutas/${path.id}/leccion/${path.modules[0].lessons[0].id}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <PlayCircle className="size-4" /> Empezar mi primera lección
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Post-clase: celebración con el resumen en camino */}
      {sp.clase === "finalizada" && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <GraduationCap className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">¡Buena clase! 🎉</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tu profesor está preparando el resumen y tus tareas — te llegarán
              por correo en unos minutos y aparecerán aquí mismo.
            </p>
          </div>
        </div>
      )}
      {sp.clase_error && CLASS_ERRORS[sp.clase_error] && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-accent bg-accent/20 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-accent-foreground" />
          <p className="text-sm font-medium">{CLASS_ERRORS[sp.clase_error]}</p>
        </div>
      )}

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

      {/* Clase en vivo con el profesor IA: checkpoint de la ruta.
          Se desbloquea al 40% — el alumno llega con avance real y dudas reales. */}
      {path.lessonCount > 0 &&
        (() => {
          const pct = Math.round((path.completedLessons / path.lessonCount) * 100);
          const unlocked = pct >= CLASS_UNLOCK_PCT;
          return (
            <div
              className={`mt-6 rounded-xl border p-5 ${
                unlocked
                  ? "border-primary/30 bg-primary/5"
                  : "border-dashed border-border bg-muted/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full border ${
                    unlocked
                      ? "border-primary/40 bg-card text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {unlocked ? (
                    <GraduationCap className="size-5" />
                  ) : (
                    <Lock className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Clase en vivo con tu profesor
                  </p>
                  {unlocked ? (
                    <>
                      <p className="mt-1 text-sm font-medium">
                        Tu profesor IA conoce tu avance, tus quizzes y tu meta.
                        Una clase de 25 min por voz para resolver tus dudas y
                        afianzar lo que viene.
                      </p>
                      <form action={startClassAction.bind(null, path.id, "class")} className="mt-3">
                        <SubmitButton variant="primary" size="sm" pendingText="Preparando tu clase…">
                          <GraduationCap className="size-4" /> Iniciar clase ahora
                        </SubmitButton>
                      </form>
                    </>
                  ) : inductionDone ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-semibold text-primary">
                        ✓ Inducción completada.
                      </span>{" "}
                      La clase completa se desbloquea al {CLASS_UNLOCK_PCT}% de
                      avance (vas en {pct}%) — tu profesor te espera con tu
                      progreso real.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-muted-foreground">
                        La clase completa se desbloquea al {CLASS_UNLOCK_PCT}%
                        de avance (vas en {pct}%). Pero tu profesor ya quiere
                        conocerte:
                      </p>
                      <form
                        action={startClassAction.bind(null, path.id, "induction")}
                        className="mt-3"
                      >
                        <SubmitButton variant="outline" size="sm" pendingText="Preparando…">
                          <GraduationCap className="size-4" /> Clase de
                          inducción: conoce a tu profesor (10 min)
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {/* Tareas del profesor (asignadas en clase) con recursos de apoyo */}
      {homework.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            📝 Tareas de tu profesor
          </p>
          <ul className="mt-3 space-y-2.5">
            {homework.map((h) => (
              <li key={h.id} className="flex items-start gap-3">
                <form action={toggleHomeworkAction.bind(null, h.id)}>
                  <button
                    type="submit"
                    aria-label={h.done ? "Marcar como pendiente" : "Marcar como hecha"}
                    className={`grid size-5 place-items-center rounded border transition-colors ${
                      h.done
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card hover:border-primary"
                    }`}
                  >
                    {h.done && <CheckCircle2 className="size-3.5" />}
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      h.done ? "text-muted-foreground line-through" : "font-medium"
                    }`}
                  >
                    {h.task}
                  </p>
                  {(h.resources ?? []).map((r, ri) => (
                    <Link
                      key={ri}
                      href={r.href}
                      className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <PlayCircle className="size-3" /> Apóyate en: {r.title}
                    </Link>
                  ))}
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {h.kind === "aplicada" ? "Práctica" : "Repaso"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {path.modules.map((m, mi) => {
          const remaining = m.lessons.length - m.completedCount;
          return (
            <section key={m.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 font-display text-sm font-semibold text-primary">
                  Módulo {mi + 1}
                  {m.source === "teacher" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                      <Sparkles className="size-3" /> De tu profesor
                    </span>
                  )}
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

      {/* Teaser de continuidad: la "ruta 2.0" existe pero se desbloquea al
          completar — el estudiante SIEMPRE sabe que hay un después. */}
      {path.lessonCount > 0 && path.completedLessons < path.lessonCount && (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/40 p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground">
              <Lock className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5" /> Tu siguiente ruta
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                Al completar esta ruta, la IA diseñará tu continuación a medida —
                construida sobre lo que habrás dominado aquí.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {path.lessonCount - path.completedLessons === 1
                  ? "Te falta solo 1 lección para desbloquearla. 🔥"
                  : `Te faltan ${path.lessonCount - path.completedLessons} lecciones para desbloquearla.`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
