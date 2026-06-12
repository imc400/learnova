/*
  Helper client-safe de Google Ads (gtag.js). No-opea si gtag no está cargado
  (NEXT_PUBLIC_GOOGLE_ADS_ID vacío, bloqueador de ads, SSR): la medición
  JAMÁS puede romper la app.
*/

import { env } from "@/lib/env";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/**
 * Dispara una conversión de Google Ads (`gtag('event', 'conversion', …)`).
 * `label` es la etiqueta de la acción de conversión (la parte tras la "/" del
 * snippet que da Google Ads). Sin ID o sin label no hace nada: un send_to sin
 * etiqueta no se atribuye a ninguna acción.
 *
 * @param label    etiqueta de la conversión (ej. "AbC-D_efG-h")
 * @param params   value/currency/transaction_id (transaction_id deduplica
 *                 recargas: la misma compra cuenta UNA vez).
 */
export function gtagConversion(
  label: string,
  params?: { value?: number; currency?: string; transactionId?: string },
): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const adsId = env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  if (!adsId || !label) return;
  try {
    window.gtag("event", "conversion", {
      send_to: `${adsId}/${label}`,
      ...(params?.value != null ? { value: params.value } : {}),
      ...(params?.currency ? { currency: params.currency } : {}),
      ...(params?.transactionId ? { transaction_id: params.transactionId } : {}),
    });
  } catch {
    // Analytics nunca lanza hacia la UI.
  }
}
