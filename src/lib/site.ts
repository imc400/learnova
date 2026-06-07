/** Configuración central del sitio: textos y precios usados en toda la UI. */
export const site = {
  name: "Learnova",
  tagline: "De querer aprenderlo a saberlo.",
  description:
    "Learnova crea tu ruta de aprendizaje a medida con IA: módulos paso a paso, pruebas reales, un tutor en vivo y el mejor video de internet curado para ti.",
  url: "https://learnova.app",
  pricing: {
    subscriptionMonthly: 15, // USD
    singlePath: 19, // USD
    currency: "USD" as const,
  },
  social: {
    instagram: "https://instagram.com/learnova",
  },
} as const;

export type Site = typeof site;
