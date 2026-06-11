"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getGenerationProgress } from "@/server/actions/progress";

/** El progreso parte en 25% (estructura lista) y el contenido cubre 25→95:
 *  el conteo de lecciones listas se deriva de ese tramo. */
const STRUCTURE_PCT = 25;
const CONTENT_SPAN_PCT = 70;

/**
 * Vive en la vista de la ruta YA navegable mientras el contenido se rellena en
 * background. Hace polling del progreso y refresca la página en cada avance,
 * para que las lecciones aparezcan "listas" a medida que se generan.
 * - showBanner: muestra la barra/aviso de avance (vista de ruta).
 *   En la página de una lección que aún se genera, se usa con showBanner={false}
 *   solo para auto-refrescar hasta que llegue su contenido.
 */
export function RouteProgressLive({
  pathId,
  initialProgress = 25,
  totalLessons = null,
  showBanner = true,
}: {
  pathId: string;
  initialProgress?: number;
  totalLessons?: number | null;
  showBanner?: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const last = useRef(initialProgress);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    async function tick() {
      try {
        const r = await getGenerationProgress(pathId);
        if (!r) return;
        if (r.generationProgress !== last.current) {
          last.current = r.generationProgress;
          setProgress(r.generationProgress);
          router.refresh(); // re-renderiza el árbol/lección con lo nuevo
        }
        if (r.generationProgress >= 100 || r.status === "failed") {
          if (timer) clearInterval(timer);
          router.refresh();
        }
      } catch {
        /* ignora errores transitorios */
      }
    }
    timer = setInterval(tick, 3000);
    void tick();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [pathId, router]);

  if (!showBanner || progress >= 100) return null;

  const lessonsReady = totalLessons
    ? Math.min(
        totalLessons,
        Math.max(
          0,
          Math.round(((progress - STRUCTURE_PCT) / CONTENT_SPAN_PCT) * totalLessons),
        ),
      )
    : null;

  return (
    <div className="mt-5 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
      <span className="flex-1 text-foreground">
        Generando el contenido de tus lecciones…{" "}
        <span className="text-muted-foreground">
          {progress}%
          {lessonsReady != null && totalLessons
            ? ` · ${lessonsReady}/${totalLessons} listas`
            : ""}
        </span>
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        Ya puedes empezar por las primeras
      </span>
    </div>
  );
}
