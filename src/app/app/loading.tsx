import { SkeletonCuaderno } from "@/components/app/brand/skeleton-cuaderno";

/* Dashboard cargando — páginas de cuaderno esperando tinta (receta R6). */

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="animate-pulse">
        <div className="h-7 w-44 rounded-md bg-muted" />
        <div className="mt-3 h-4 w-72 max-w-full rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SkeletonCuaderno lineas={3} />
        <SkeletonCuaderno lineas={2} />
      </div>
    </div>
  );
}
