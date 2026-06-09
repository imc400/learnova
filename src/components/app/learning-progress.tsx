/**
 * Barra de progreso de APRENDIZAJE (lecciones completadas por el usuario).
 * Distinta del progreso de generación: esta refleja el avance real.
 * El relleno tiene un mínimo visual para que una ruta empezada nunca se vea
 * "en cero" (goal-gradient), pero la etiqueta siempre dice la verdad.
 */
export function LearningProgress({
  done,
  total,
  size = "md",
  showLabel = true,
  className = "",
}: {
  done: number;
  total: number;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const fill = total > 0 ? Math.max(pct, done > 0 ? 6 : 2) : 0;
  const height = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="font-medium text-foreground">
            {done} de {total} lecciones
          </span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Avance: ${done} de ${total} lecciones completadas`}
        className={`${height} w-full overflow-hidden rounded-full bg-muted`}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.min(fill, 100)}%` }}
        />
      </div>
    </div>
  );
}
