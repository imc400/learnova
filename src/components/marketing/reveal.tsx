"use client";

/**
 * Reveal — revelado on-scroll sin dependencias (IntersectionObserver + CSS).
 *
 * - El estado oculto/visible vive en CSS (globals.css, selector [data-reveal]).
 *   El componente solo añade `data-revealed` cuando el elemento entra al viewport.
 * - SSR-safe: no toca window/document en render; el HTML del servidor sale con
 *   data-reveal y el CSS solo lo oculta bajo @media (scripting: enabled), así
 *   que sin JS el contenido es visible (progressive enhancement, cero SEO-risk).
 * - Un solo IntersectionObserver compartido por combinación threshold|rootMargin
 *   (no uno por elemento) y cada elemento se observa UNA sola vez: al revelarse
 *   se des-observa.
 * - Compatible con padres server components: acepta children como ReactNode,
 *   por lo que secciones enteras renderizadas en el servidor pasan a través
 *   sin convertirse en client components.
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type Ref,
} from "react";

export type RevealVariant =
  | "fade-up"
  | "fade-in"
  | "scale-in"
  | "slide-left"
  | "slide-right"
  | "none"; // sentinel: no se oculta; solo dispara [data-revealed] para hijos/selectores

export interface RevealProps {
  children: ReactNode;
  /** Estilo de entrada; mapea 1:1 a los selectores [data-reveal=...] de globals.css. */
  variant?: RevealVariant;
  /** Posición dentro de una lista (cards, logos, features) para el stagger. */
  index?: number;
  /** Delay extra por índice, en ms. delay total = delay + index * stagger. */
  stagger?: number;
  /** Delay base en ms. */
  delay?: number;
  /** Fracción visible del elemento que dispara el revelado (0–1). */
  threshold?: number;
  /** rootMargin del observer. El -8% inferior evita disparos en el borde exacto. */
  rootMargin?: string;
  /** Tag contenedor (div, section, li, …) para mantener HTML semántico. */
  as?: ElementType;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Observers compartidos a nivel de módulo (solo se crean en cliente). */
/* ------------------------------------------------------------------ */

const callbacks = new WeakMap<Element, () => void>();
const observers = new Map<string, IntersectionObserver>();

function getObserver(threshold: number, rootMargin: string): IntersectionObserver {
  const key = `${threshold}|${rootMargin}`;
  let observer = observers.get(key);
  if (!observer) {
    observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          callbacks.get(entry.target)?.();
          callbacks.delete(entry.target);
          obs.unobserve(entry.target); // una sola observación por elemento
        }
      },
      { threshold, rootMargin },
    );
    observers.set(key, observer);
  }
  return observer;
}

/* ------------------------------------------------------------------ */

export function Reveal({
  children,
  variant = "fade-up",
  index = 0,
  stagger = 70,
  delay = 0,
  threshold = 0.15,
  rootMargin = "0px 0px -8% 0px",
  as: Tag = "div",
  className,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // Ya revelado (StrictMode double-invoke / re-mounts del App Router): no repetir.
    if (el.dataset.revealed !== undefined) return;

    const reveal = () => {
      el.dataset.revealed = "";
    };

    // Fallback duro: sin IntersectionObserver (bots, browsers antiguos) o con
    // reduced-motion activo → revelar de inmediato, sin animación.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      reveal();
      return;
    }

    callbacks.set(el, reveal);
    const observer = getObserver(threshold, rootMargin);
    observer.observe(el);

    return () => {
      observer.unobserve(el);
      callbacks.delete(el);
    };
  }, [threshold, rootMargin]);

  return (
    <Tag
      ref={ref as Ref<HTMLElement>}
      data-reveal={variant}
      className={className}
      style={
        delay + index * stagger > 0
          ? ({ "--reveal-delay": `${delay + index * stagger}ms` } as CSSProperties)
          : undefined
      }
    >
      {children}
    </Tag>
  );
}
