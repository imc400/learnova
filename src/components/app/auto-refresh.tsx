"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-consulta el server component cada N segundos (polling de estado). */
export function AutoRefresh({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
