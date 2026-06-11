import { SkeletonCuaderno } from "@/components/app/brand/skeleton-cuaderno";

/* Detalle de ruta cargando — módulos como páginas en blanco (receta R6). */

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="animate-pulse">
        <div className="h-7 w-2/3 rounded-md bg-muted" />
        <div className="mt-3 h-4 w-40 rounded-md bg-muted" />
      </div>
      <SkeletonCuaderno lineas={3} />
      <SkeletonCuaderno lineas={3} />
      <SkeletonCuaderno lineas={2} />
    </div>
  );
}
