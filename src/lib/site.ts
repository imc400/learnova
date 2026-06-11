/** Configuración central del sitio: textos y precios usados en toda la UI. */
export const site = {
  name: "Aulia",
  tagline: "De querer aprenderlo a saberlo.",
  description:
    "Aulia crea tu ruta de aprendizaje a medida con IA: módulos paso a paso, pruebas reales, un tutor en vivo y el mejor video de internet curado para ti.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://aulia.ai",
  pricing: {
    singlePath: 9990, // CLP, pago único
    proThirtyDays: 24990, // CLP, cobro único 30 días, sin renovación automática
    currency: "CLP" as const,
  },
  social: {
    instagram: "https://instagram.com/aulia",
  },
} as const;

export type Site = typeof site;
