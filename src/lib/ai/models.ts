/*
  Estrategia de modelos POR NIVELES (todo Anthropic, un solo proveedor).
  Cambiar de modelo por tarea = cambiar un string aquí, sin tocar la lógica.
*/
export const MODELS = {
  /** Nivel 1 — planificar el currículum (lo difícil, 1 vez por ruta). */
  planner: "claude-opus-4-8",
  /** Nivel 2 — generar lecciones, notas y quizzes (el 80% del volumen). */
  generator: "claude-sonnet-4-6",
  /** Nivel 3 — rankear videos, clasificar y corregir respuestas. */
  ranker: "claude-haiku-4-5",
  // Tutor de texto: Haiku 4.5 — con el contexto de la lección + memoria del
  // profesor responde excelente, ~3-5x más barato que Sonnet y con primer
  // token más rápido (clave en móvil). La VOZ sigue en Sonnet (decisión
  // fundador 2026-06-11: chat barato, voz premium).
  tutor: "claude-haiku-4-5",
} as const;

export type ModelTier = keyof typeof MODELS;

/** Límites de salida razonables por tarea (no-streaming → mantener < ~16k).
 *  planner: un esqueleto real son 2-4K tokens; 12K solo añadía riesgo de
 *  timeout non-streaming sin comprar nada (A-P1.8). */
export const MAX_TOKENS = {
  planner: 6000,
  generator: 8000,
  ranker: 2000,
} as const;
