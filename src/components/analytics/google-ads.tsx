"use client";

import Script from "next/script";
import { env } from "@/lib/env";

/*
  Etiqueta global de Google Ads (gtag.js) para medición de conversiones de
  campañas. Solo se inyecta si NEXT_PUBLIC_GOOGLE_ADS_ID está seteado — sin
  ID, este componente es null y la app no carga ni un byte de Google.

  La conversión de COMPRA se dispara aparte (PurchaseTracker → gtagConversion),
  con la etiqueta de la acción de conversión. Esta etiqueta base habilita
  además remarketing y conversiones mejoradas.
*/

const ADS_ID = env.NEXT_PUBLIC_GOOGLE_ADS_ID;

export function GoogleAds() {
  if (!ADS_ID) return null;

  return (
    <>
      <Script
        id="gtag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`}
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ADS_ID}');`}
      </Script>
    </>
  );
}
