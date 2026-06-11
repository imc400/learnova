import { cn } from "@/lib/utils";

/*
  Esqueleto de carga "página de cuaderno" (receta R6) — para los loading.tsx
  del interior. Papel rayado + líneas que respiran.
*/

export function SkeletonCuaderno({
  lineas = 3,
  className,
}: {
  lineas?: number;
  className?: string;
}) {
  const anchos = ["w-full", "w-5/6", "w-2/3"];
  return (
    <div
      aria-busy="true"
      className={cn(
        "ruled animate-pulse rounded-lg border border-border bg-card p-5 shadow-soft",
        className,
      )}
    >
      <div className="h-5 w-2/5 rounded-md bg-muted" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lineas }).map((_, i) => (
          <div key={i} className={cn("h-3.5 rounded-md bg-muted", anchos[i % 3])} />
        ))}
      </div>
    </div>
  );
}
