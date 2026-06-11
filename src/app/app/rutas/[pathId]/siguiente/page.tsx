import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Trophy } from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { learningPaths, lessons, modules, progress } from "@/db/schema";
import { getOrCreateNextPathSuggestion, nextPathUrl } from "@/lib/next-path";
import { createNextPathIntentAction } from "@/server/actions/next-path";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { Spark } from "@/components/marketing/landing/icons";

export const metadata = { title: "Tu siguiente paso" };

/*
  Puente GET-seguro del "Siguiente paso": los CTAs de correo (path_completed /
  reengagement) aterrizan AQUÍ — un GET jamás crea intents (los escáneres de
  links de los clientes de correo seguirían el link y fabricarían carros
  fantasma). Un clic más (POST) crea el intent y va directo al temario
  bloqueado. La card de la ruta hace el POST directo, sin pasar por aquí.
*/

const VIAS = new Set(["card", "email", "clase_cierre"]);

export default async function SiguientePasoPage({
  params,
  searchParams,
}: {
  params: Promise<{ pathId: string }>;
  searchParams: Promise<{ via?: string }>;
}) {
  const { pathId } = await params;
  const sp = await searchParams;
  const via = sp.via && VIAS.has(sp.via) ? sp.via : "email";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [path] = await db
    .select({ id: learningPaths.id, title: learningPaths.title })
    .from(learningPaths)
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, user.id)))
    .limit(1);
  if (!path) notFound();

  // El siguiente paso existe SOLO desde el 100% — antes, de vuelta a la ruta.
  const [prog] = await db
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .leftJoin(
      progress,
      and(eq(progress.lessonId, lessons.id), eq(progress.userId, user.id)),
    )
    .where(eq(modules.pathId, pathId));
  if (!prog || prog.total === 0 || prog.done < prog.total) {
    redirect(`/app/rutas/${pathId}`);
  }

  const suggestion = await getOrCreateNextPathSuggestion({
    userId: user.id,
    sourcePathId: pathId,
  });
  if (!suggestion) redirect(`/app/rutas/${pathId}`);

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href={`/app/rutas/${pathId}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> «{path.title}»
      </Link>

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card p-6 shadow-soft">
        <Badge variant="primary">
          <Spark size={14} /> tu siguiente ruta
        </Badge>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">
          {suggestion.topic}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{suggestion.goal}</p>

        {suggestion.reasons.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {suggestion.reasons.slice(0, 3).map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm">
                <Trophy className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        <form
          action={createNextPathIntentAction.bind(null, pathId, via)}
          className="mt-6"
        >
          <SubmitButton size="lg" pendingText="Preparando tu temario…">
            Crear mi siguiente ruta <ArrowRight className="size-4" />
          </SubmitButton>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Se genera a tu medida, construyendo sobre lo que ya dominas. Ves tu
          temario completo antes de pagar.{" "}
          <Link
            href={nextPathUrl(suggestion, pathId, via as "card" | "email" | "clase_cierre")}
            className="font-medium text-foreground underline"
          >
            Ajustar antes de crear
          </Link>
        </p>
      </div>
    </div>
  );
}
