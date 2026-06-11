import { SkeletonCuaderno } from "@/components/app/brand/skeleton-cuaderno";

/*
  Paywall cargando — zona sobria: texto literal y claro, sin gestos
  manuscritos (el dinero se trata con tipografía limpia).
*/

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground" role="status">
        Cargando tu resumen de pago…
      </p>
      <SkeletonCuaderno lineas={3} />
      <SkeletonCuaderno lineas={2} />
    </div>
  );
}
