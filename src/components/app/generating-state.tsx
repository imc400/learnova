"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getGenerationProgress } from "@/server/actions/progress";

/** Polling de RESPALDO (Realtime es la vía rápida): ≥5s para no duplicar. */
const POLL_INTERVAL_MS = 5000;

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
  // Estado failed PROPIO: jamás forzar la barra a 100 (flash "¡Ruta lista!").
  const [failed, setFailed] = useState(false);

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

      if (p.status === "failed" && !finishedRef.current) {
        finishedRef.current = true;
        setFailed(true);
        // El refresh muestra la vista de error del servidor (con salida real).
        setTimeout(() => router.refresh(), 600);
        return;
      }
      if (p.status === "ready" && !finishedRef.current) {
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

    // UN solo mecanismo principal: Realtime para updates instantáneos, con
    // polling de RESPALDO cada 5s (usa la sesión del servidor). Si el WebSocket
    // se suscribe pero no entrega eventos (RLS/auth), la barra no se pega.
    poll = setInterval(pollOnce, POLL_INTERVAL_MS);
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

  const done = !failed && progress >= 100;
  const pct = Math.min(100, Math.max(0, progress));

  // Error: tinta roja sobre layout recto, sin gestos (zona de sobriedad).
  if (failed) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center sm:p-12">
        <AlertTriangle className="mx-auto size-8 text-destructive" />
        <h2 className="mt-4 font-display text-lg font-semibold">
          No pudimos terminar tu ruta
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Algo falló durante la generación — no perdiste nada. Estamos cargando
          el detalle, o escríbenos a hola@aulia.ai y lo resolvemos.
        </p>
      </div>
    );
  }

  return (
    <div className="ruled mock-margin rounded-xl border border-border bg-card p-8 shadow-lift sm:p-12">
      <div className="flex flex-col items-center text-center">
        {done ? (
          <CheckCircle2 className="size-10 text-primary" />
        ) : (
          <Loader2 className="size-10 animate-spin text-primary" />
        )}
        <h2 className="mt-6 font-display text-xl font-semibold">
          {done ? "¡Ruta lista!" : "Diseñando tu ruta…"}
        </h2>

        {/* Barra de progreso REAL — avanza "a tics", como quien marca casillas */}
        <div className="mt-6 w-full max-w-md">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="progress-fill animate-tick-progress h-full rounded-full bg-primary"
              style={{ "--progress": pct / 100 } as CSSProperties}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress}% completado</span>
            {!done && (
              <span>{eta ? `${eta} restante` : "Calculando tiempo…"}</span>
            )}
          </div>
        </div>

        {/* Paso actual real, como nota al margen (accesible) */}
        <p
          className="hand mt-5 min-h-6 text-sm"
          aria-live="polite"
          aria-atomic="true"
        >
          {step} ✺
        </p>

        <p className="mt-6 max-w-sm text-xs text-muted-foreground">
          Puedes cerrar esta página; tu ruta se seguirá generando y la
          encontrarás en “Mis rutas”.
        </p>
      </div>
    </div>
  );
}
