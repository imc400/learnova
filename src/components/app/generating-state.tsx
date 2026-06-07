"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const STEPS = [
  "Diseñando tu currículum a medida…",
  "Estructurando los módulos paso a paso…",
  "Escribiendo lecciones y notas…",
  "Creando pruebas para confirmar tu aprendizaje…",
  "Curando los mejores videos para cada paso…",
  "Dando los toques finales…",
];

/** Mientras la ruta se genera, refresca la página cada 5s y rota mensajes. */
export function GeneratingState() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), 5000);
    const rotate = setInterval(
      () => setStep((s) => (s + 1) % STEPS.length),
      2800,
    );
    return () => {
      clearInterval(refresh);
      clearInterval(rotate);
    };
  }, [router]);

  return (
    <div className="grid place-items-center rounded-xl border border-border bg-card py-24 text-center">
      <Loader2 className="size-10 animate-spin text-primary" />
      <h2 className="mt-6 font-display text-xl font-semibold">
        Creando tu ruta
      </h2>
      <p className="mt-2 h-5 text-sm text-muted-foreground transition-opacity">
        {STEPS[step]}
      </p>
      <p className="mt-6 max-w-sm text-xs text-muted-foreground">
        Esto puede tomar unos minutos. Puedes dejar esta página abierta; se
        actualizará sola cuando esté lista.
      </p>
    </div>
  );
}
