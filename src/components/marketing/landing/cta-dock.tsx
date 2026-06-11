import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import { site } from "@/lib/site";

/* §5.16 CTA dock sticky mobile — último hijo del wrapper post-hero (sticky CSS, cero JS) */

export function CtaDock() {
  return (
    <div
      className="sticky bottom-0 z-30 border-t border-border bg-card
                 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <p className="text-sm leading-tight">
          <span className="font-semibold">
            Tu ruta · {formatPrice(site.pricing.singlePath, "CLP")}
          </span>
          <span className="block text-xs text-muted-foreground">
            pago único · garantía 7 días
          </span>
        </p>
        <Button asChild size="sm" className="h-11">
          <Link href="/empieza/ruta">Diseñar mi ruta</Link>
        </Button>
      </div>
    </div>
  );
}
