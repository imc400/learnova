import { SkeletonCuaderno } from "@/components/app/brand/skeleton-cuaderno";

/* Sala de control cargando — zona sobria (tablas y números), sin gestos. */

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="animate-pulse">
        <div className="h-7 w-48 rounded-md bg-muted" />
      </div>
      <SkeletonCuaderno lineas={2} />
      <SkeletonCuaderno lineas={3} />
      <SkeletonCuaderno lineas={3} />
    </div>
  );
}
