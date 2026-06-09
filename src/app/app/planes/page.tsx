import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/subscription";
import { startProSubscriptionAction } from "@/server/actions/checkout";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";
import { site } from "@/lib/site";

export const metadata = { title: "Planes" };

export default async function PlansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ent = user ? await getEntitlement(user.id) : { plan: "free", isPro: false };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Plan Pro</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Desbloquea rutas y tutor ilimitados.
      </p>

      <div className="mt-6 rounded-xl border border-primary bg-card p-6 shadow-lift">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Aulia Pro</h2>
          {ent.isPro && <Badge variant="primary">Tu plan actual</Badge>}
        </div>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="font-display text-3xl font-bold">
            {formatPrice(site.pricing.subscriptionMonthly)}
          </span>
          <span className="text-sm text-muted-foreground">/mes</span>
        </div>
        <ul className="mt-5 space-y-2.5 text-sm">
          {["Rutas ilimitadas", "Tutor en vivo ilimitado", "Pruebas y certificados", "Progreso y rachas"].map((f) => (
            <li key={f} className="flex items-center gap-2.5">
              <Check className="size-4 shrink-0 text-primary" /> {f}
            </li>
          ))}
        </ul>
        {!ent.isPro && (
          <form action={startProSubscriptionAction} className="mt-6">
            <SubmitButton size="lg" className="w-full" pendingText="Redirigiendo a Flow…">
              Hazte Pro
            </SubmitButton>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Pago seguro con Flow (Webpay). Cancela cuando quieras.
      </p>
    </div>
  );
}
