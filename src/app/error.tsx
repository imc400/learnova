"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
  Error boundary raíz — zona de sobriedad total: lápiz rojo, layout recto,
  CERO gestos manuscritos (el recetario prohíbe Caveat/humor en errores).
  Fórmula del copy: qué pasó + qué NO pasó + qué hacer.
*/

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Visibilidad en consola/monitoring; sin PII.
    console.error("[error-boundary]", error.digest ?? error.message);
    // Alerta ops al fundador (fire-and-forget): el digest llega por correo
    // al instante — sin esperar a que el usuario reclame (lección de la
    // demo universidad 2026-06-12, donde el aula murió en silencio).
    void fetch("/api/ops/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digest: error.digest ?? null,
        path: window.location.pathname,
        message: error.digest ? null : error.message?.slice(0, 300),
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-md">
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-soft"
        >
          <AlertCircle className="mx-auto size-8 text-destructive" />
          <h1 className="mt-4 font-display text-2xl text-balance">
            Algo se cayó de nuestro lado
          </h1>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-muted-foreground">
            Tu cuenta y tu avance están a salvo. Si estabas pagando, no se hizo
            ningún cobro — escríbenos a{" "}
            <a
              href="mailto:hola@aulia.ai"
              className="font-medium text-primary hover:underline"
            >
              hola@aulia.ai
            </a>{" "}
            y lo vemos contigo.
          </p>
          <Button onClick={reset} className="mt-6">
            Intentar de nuevo
          </Button>
        </div>
      </div>
    </main>
  );
}
