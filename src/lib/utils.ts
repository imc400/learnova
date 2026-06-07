import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases condicionales y resuelve conflictos de Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea un precio en CLP o USD para la UI. */
export function formatPrice(
  amount: number,
  currency: "CLP" | "USD" = "USD",
): string {
  return new Intl.NumberFormat(currency === "CLP" ? "es-CL" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(amount);
}

/** Genera un slug URL-safe a partir de un texto (ej. nombre de ruta). */
export function slugify(text: string): string {
  return text
    .toString()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // elimina diacríticos (tildes, ñ→n se maneja aparte)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
