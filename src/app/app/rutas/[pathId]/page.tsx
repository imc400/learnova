import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ChevronRight,
  Clock,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPathTree } from "@/server/queries/paths";
import { GeneratingState } from "@/components/app/generating-state";
import { RouteProgressLive } from "@/components/app/route-progress-live";
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

      <div className="mt-8 space-y-6">
        {path.modules.map((m, mi) => (
          <section key={m.id}>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-sm font-semibold text-primary">
                Módulo {mi + 1}
              </span>
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold">{m.title}</h2>
            {m.objective && (
              <p className="mt-1 text-sm text-muted-foreground">{m.objective}</p>
            )}
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {m.lessons.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/app/rutas/${path.id}/leccion/${l.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted"
                  >
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs ${
                        l.content
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {l.content ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                    </span>
                    <span className="flex-1 text-sm font-medium">{l.title}</span>
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
        ))}
      </div>
    </div>
  );
}
