import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Check, Spark } from "@/components/marketing/landing/icons";
import {
  getOrCreateNextPathSuggestion,
  nextPathUrl,
} from "@/lib/next-path";
import { createNextPathIntentAction } from "@/server/actions/next-path";
import { SubmitButton } from "@/components/app/submit-button";

/*
  "Siguiente paso": aparece SOLO con la ruta al 100% (el pico motivacional).
  Una sugerencia protagonista generada desde lo aprendido — la siguiente ruta
  no existe en ningún catálogo: se crea a medida si el estudiante la acepta.
  El CTA es UN clic (POST → intent + preview → paywall): del trofeo al temario
  bloqueado sin re-pasar por el wizard; "ajustar" queda como salida menor.
*/

export async function NextStepCard({
  pathId,
  userId,
  moduleTitles,
}: {
  pathId: string;
  userId: string;
  moduleTitles: string[];
}) {
  const suggestion = await getOrCreateNextPathSuggestion({
    userId,
    sourcePathId: pathId,
  });
  if (!suggestion) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card p-6 shadow-soft">
      <Badge variant="primary">
        <Spark size={14} /> tu siguiente ruta
      </Badge>
      <h2 className="mt-3 font-display text-xl font-bold tracking-tight">
        {suggestion.topic}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{suggestion.goal}</p>

      {suggestion.reasons.length > 0 && (
        <ul className="mt-3 space-y-1">
          {suggestion.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-sm">
              <Trophy className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {moduleTitles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {moduleTitles.slice(0, 6).map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              <Check size={11} className="shrink-0 text-primary" /> {t}
            </span>
          ))}
        </div>
      )}

      <form action={createNextPathIntentAction.bind(null, pathId, "card")} className="mt-5">
        <SubmitButton size="sm" pendingText="Preparando tu temario…">
          Crear mi siguiente ruta <ArrowRight className="size-4" />
        </SubmitButton>
      </form>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Se genera a tu medida, construyendo sobre lo que ya dominas.{" "}
        <Link
          href={nextPathUrl(suggestion, pathId, "card")}
          className="font-medium text-foreground underline"
        >
          Ajustar antes de crear
        </Link>
      </p>
    </div>
  );
}
