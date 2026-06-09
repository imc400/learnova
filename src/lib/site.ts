/** Configuración central del sitio: textos y precios usados en toda la UI. */
export const site = {
  name: "Aulia",
  tagline: "De querer aprenderlo a saberlo.",
  description:
    "Aulia crea tu ruta de aprendizaje a medida con IA: módulos paso a paso, pruebas reales, un tutor en vivo y el mejor video de internet curado para ti.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://aulia.ai",
  pricing: {
    subscriptionMonthly: 15, // USD
    singlePath: 19, // USD
    currency: "USD" as const,
  },
  social: {
    instagram: "https://instagram.com/aulia",
  },
} as const;

export type Site = typeof site;
