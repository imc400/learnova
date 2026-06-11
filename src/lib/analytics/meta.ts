/*
  Helper client-safe del píxel de Meta. No-opea si el píxel no está cargado
  (NEXT_PUBLIC_META_PIXEL_ID vacío, bloqueador de ads, SSR): la medición
  JAMÁS puede romper la app.
*/

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Dispara un evento estándar del píxel (`fbq('track', …)`).
 * `eventId` deduplica en Meta: recargas del navegador con el mismo eventID
 * cuentan UNA vez, y un Purchase de la Conversions API con el mismo event_id
 * no se suma al del píxel.
 */
export function fbqTrack(
  event: string,
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  try {
    if (eventId) {
      window.fbq("track", event, params ?? {}, { eventID: eventId });
    } else {
      window.fbq("track", event, params ?? {});
    }
  } catch {
    // Analytics nunca lanza hacia la UI.
  }
}
