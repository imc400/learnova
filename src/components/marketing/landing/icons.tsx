import type { CSSProperties } from "react";

/*
  Iconos SVG inline de la landing (estilo lucide: stroke currentColor, w=2).
  Hand-rolled para controlar los paths que se animan (CheckDraw) y los gestos
  manuscritos (ArrowDoodle). 16 px por defecto — el tamaño se pasa por prop.
*/

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
}

export function Spark({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M12 3l1.9 5.4a2 2 0 0 0 1.2 1.2L20.5 11.5l-5.4 1.9a2 2 0 0 0-1.2 1.2L12 20l-1.9-5.4a2 2 0 0 0-1.2-1.2L3.5 11.5l5.4-1.9a2 2 0 0 0 1.2-1.2L12 3z" />
    </svg>
  );
}

export function Check({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

/** Check que se dibuja (stroke-dashoffset). Pasa --draw-delay vía style. */
export function CheckDraw({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path className="check-draw" d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function Lock({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="4.5" y="11" width="15" height="9.5" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function Flame({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M12 21c3.9 0 6.5-2.5 6.5-6.2 0-2.6-1.6-4.6-3-6.3-.7-.8-2-.3-2 .8v.9c0 .8-1 1.3-1.6.7C10.6 9.6 10 7.8 10 5.6c0-1-1.2-1.6-1.9-.9C6.3 6.6 5.5 9.7 5.5 12.2 5.5 18 8.1 21 12 21z" />
    </svg>
  );
}

export function Play({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M7 5.5v13l11-6.5L7 5.5z" />
    </svg>
  );
}

export function Shield({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M12 3l7.5 3v5.6c0 4.6-3.1 7.6-7.5 9.4-4.4-1.8-7.5-4.8-7.5-9.4V6l7.5-3z" />
      <path d="M9 11.8l2.1 2.1L15.5 9.5" />
    </svg>
  );
}

export function Mic({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function Mail({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7.5l8 6 8-6" />
    </svg>
  );
}

/** Sello/timbre de garantía (rosette). */
export function Seal({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M12 3.2l2 1.6 2.5-.4 1 2.3 2.3 1-.4 2.5 1.6 2-1.6 2 .4 2.5-2.3 1-1 2.3-2.5-.4-2 1.6-2-1.6-2.5.4-1-2.3-2.3-1 .4-2.5-1.6-2 1.6-2-.4-2.5 2.3-1 1-2.3 2.5.4 2-1.6z" />
      <path d="M9.2 12.2l2 2 3.8-4" />
    </svg>
  );
}

/** Flecha manuscrita (trazo irregular, gesto de cuaderno) apuntando abajo. */
export function ArrowDoodle({ size = 40, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={style}
    >
      <path d="M20 4c-3 5 2 7-1.5 12.5C15 22 19 25 19.5 33" />
      <path d="M13.5 27.5c2 2.6 4 4.6 6 5.8 1.4-2.4 3.2-4.6 5.6-6.2" />
    </svg>
  );
}

export function Chevron({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
