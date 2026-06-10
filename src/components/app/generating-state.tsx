"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getGenerationProgress } from "@/server/actions/progress";

/** Extrae "N" de un paso tipo "Lección N/Total: …". */
function parseDone(step: string | null, total: number | null): number | null {
  const m = step?.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return total ? Math.min(n, total) : n;
}

/** ETA honesto por throughput real medido en el cliente (+20% de margen). */
function formatEta(
  done: number | null,
  total: number | null,
  startedAtMs: number | null,
): string | null {
  if (!total || !startedAtMs || !done || done < 1) return null;
  const elapsed = (Date.now() - startedAtMs) / 1000;
  if (elapsed < 2) return null;
  const rate = done / elapsed; // lecciones por segundo
  if (rate <= 0) return null;
  const remaining = ((total - done) / rate) * 1.2;
  if (remaining <= 2) return "casi listo";
  if (remaining < 45) return "menos de 1 min";
  if (remaining < 90) return "~1 min";
  return `~${Math.ceil(remaining / 60)} min`;
}

interface Props {
  pathId: string;
  initialProgress?: number;
  initialStep?: string;
  totalLessons?: number | null;
  generationStartedAt?: string | null;
}

export function GeneratingState({
  pathId,
  initialProgress = 0,
  initialStep = "Iniciando…",
  totalLessons = null,
  generationStartedAt = null,
}: Props) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [step, setStep] = useState(initialStep);
  const [eta, setEta] = useState<string | null>(null);

  const doneRef = useRef<number | null>(null);
  const totalRef = useRef<number | null>(totalLessons);
  const startedRef = useRef<number | null>(
    generationStartedAt ? new Date(generationStartedAt).getTime() : null,
  );
  const finishedRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let poll: ReturnType<typeof setInterval> | null = null;
    const etaTimer = setInterval(
      () => setEta(formatEta(doneRef.current, totalRef.current, startedRef.current)),
      2000,
    );

    function apply(p: {
      progress: number | null;
      step: string | null;
      status: string | null;
      total: number | null;
      startedAt: string | null;
    }) {
      if (typeof p.progress === "number") {
        const next = p.progress;
        setProgress((prev) => Math.max(prev, next)); // nunca retrocede
      }
      if (p.step) setStep(p.step);
      if (p.total != null) totalRef.current = p.total;
      if (p.startedAt) startedRef.current = new Date(p.startedAt).getTime();
      const d = parseDone(p.step, totalRef.current);
      if (d != null) doneRef.current = d;
      setEta(formatEta(doneRef.current, totalRef.current, startedRef.current));

      if ((p.status === "ready" || p.status === "failed") && !finishedRef.current) {
        finishedRef.current = true;
        setProgress(100);
        setTimeout(() => router.refresh(), 400);
      }
    }

    async function pollOnce() {
      try {
        const r = await getGenerationProgress(pathId);
        if (r)
          apply({
            progress: r.generationProgress,
            step: r.generationStep,
            status: r.status,
            total: r.totalLessons,
            startedAt: r.generationStartedAt,
          });
      } catch {
        /* ignora errores transitorios del poll */
      }
    }

    // Polling SIEMPRE activo como fuente confiable (cada 2s, usa la sesión
    // autenticada del servidor). Realtime es un extra para updates instantáneos;
    // si el WebSocket se suscribe pero no entrega eventos (RLS/auth), el polling
    // garantiza que la barra NUNCA se quede pegada.
    poll = setInterval(pollOnce, 2000);
    void pollOnce();

    const channel = supabase
      .channel(`path-progress-${pathId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "learning_paths",
          filter: `id=eq.${pathId}`,
        },
        (payload) => {
          const n = payload.new as Record<string, unknown>;
          apply({
            progress: (n.generation_progress as number) ?? null,
            step: (n.generation_step as string) ?? null,
            status: (n.status as string) ?? null,
            total: (n.total_lessons as number) ?? null,
            startedAt: (n.generation_started_at as string) ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      if (poll) clearInterval(poll);
      clearInterval(etaTimer);
      supabase.removeChannel(channel);
    };
  }, [pathId, router]);

  const done = progress >= 100;

  return (
    <div className="rounded-xl border border-border bg-card p-8 sm:p-12">
      <div className="flex flex-col items-center text-center">
        {done ? (
          <CheckCircle2 className="size-10 text-primary" />
        ) : (
          <Loader2 className="size-10 animate-spin text-primary" />
        )}
        <h2 className="mt-6 font-display text-xl font-semibold">
          {done ? "¡Ruta lista!" : "Construyendo tu ruta"}
        </h2>

        {/* Barra de progreso REAL */}
        <div className="mt-6 w-full max-w-md">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress}% completado</span>
            {!done && (
              <span>{eta ? `⏱ ${eta} restante` : "Calculando tiempo…"}</span>
            )}
          </div>
        </div>

        {/* Paso actual real (accesible) */}
        <p
          className="mt-5 min-h-5 text-sm text-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {step}
        </p>

        <p className="mt-6 max-w-sm text-xs text-muted-foreground">
          Puedes cerrar esta página; tu ruta se seguirá generando y la
          encontrarás en “Mis rutas”.
        </p>
      </div>
    </div>
  );
}
