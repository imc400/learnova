import Link from "next/link";
import { ArrowRight, Sparkles, Trophy } from "lucide-react";
import {
  getOrCreateNextPathSuggestion,
  nextPathUrl,
} from "@/lib/next-path";

/*
  "Siguiente paso": aparece SOLO con la ruta al 100% (el pico motivacional).
  Una sugerencia protagonista generada desde lo aprendido — la siguiente ruta
  no existe en ningún catálogo: se crea a medida si el estudiante la acepta.
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
    <div className="mt-6 overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-accent/10 p-6">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
        <Sparkles className="size-3.5" /> Siguiente paso
      </p>
      <h2 className="mt-2 font-display text-xl font-bold tracking-tight">
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
              className="rounded-full border border-primary/20 bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              ✓ {t}
            </span>
          ))}
        </div>
      )}

      <Link
        href={nextPathUrl(suggestion, pathId)}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Crear mi siguiente ruta <ArrowRight className="size-4" />
      </Link>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Se genera a tu medida, construyendo sobre lo que ya dominas.
      </p>
    </div>
  );
}
