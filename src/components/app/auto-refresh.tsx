"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-consulta el server component cada N segundos (polling de estado).
 * Con `maxAttempts` deja de refrescar al agotar los intentos y renderiza
 * `fallback` (el estado del cliente sobrevive a router.refresh(), así que
 * el contador no se reinicia entre refrescos).
 */
export function AutoRefresh({
  seconds = 4,
  maxAttempts,
  fallback,
}: {
  seconds?: number;
  /** Sin definir = refresca indefinidamente (comportamiento original). */
  maxAttempts?: number;
  /** Qué mostrar cuando se agotan los intentos. */
  fallback?: ReactNode;
}) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const exhausted = maxAttempts !== undefined && attempts >= maxAttempts;

  useEffect(() => {
    if (exhausted) return;
    const t = setInterval(() => {
      setAttempts((a) => a + 1);
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds, exhausted]);

  if (exhausted) return <>{fallback ?? null}</>;
  return null;
}
