import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";
import { Spark, Seal, Shield, Mic } from "@/components/marketing/landing/icons";
import { RoutePreviewHero } from "@/components/marketing/landing/route-preview-hero";

/*
  §5.1 Hero — «El cuaderno abierto».
  100% CSS puro (cero <Reveal> above-the-fold): coreografía con
  animation-delay absolutos. Reduced-motion / sin JS: todo pintado.
*/
export function Hero() {
  return (
    <section className="overflow-hidden py-16 lg:py-28">
      <div className="container-page">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          {/* Columna de copy */}
          <div className="min-w-0 lg:col-span-6">
            <div className="animate-fade-up">
              <span className="tab-note">
                <Spark size={16} />
                la nueva forma de aprender
              </span>
            </div>

            <h1 className="animate-fade-up mt-5 font-display text-4xl text-balance sm:text-5xl lg:text-6xl">
              De querer aprenderlo a{" "}
              <span className="hl-draw animate-draw-underline [animation-delay:600ms]">
                saberlo
              </span>
              .
            </h1>

            <p className="animate-fade-in [animation-delay:500ms] mt-2 block">
              <span className="hand inline-block rotate-[-2deg]">
                esto no es otro curso ✺
              </span>
            </p>

            <p className="animate-fade-up [animation-delay:120ms] mt-5 max-w-[58ch] text-base text-muted-foreground sm:text-lg">
              Dinos qué quieres aprender y la IA diseña una ruta solo para ti:
              los mejores videos de YouTube marcados al minuto, quizzes que
              prueban que lo dominas, y un profesor con voz que se acuerda de
              tu avance.
            </p>

            <div className="animate-fade-up [animation-delay:220ms] mt-8">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/empieza/ruta">Diseñar mi ruta</Link>
              </Button>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm text-muted-foreground">
                  2 minutos · ves tu temario completo antes de pagar
                </p>
                <span className="hand text-base">
                  primero la ves, después decides ✺
                </span>
              </div>
            </div>

            <div className="animate-fade-up [animation-delay:320ms] mt-8 flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-card">
                <Seal size={16} />
                {formatPrice(9990, "CLP")} una vez, tuya para siempre
              </Badge>
              <Badge variant="outline" className="bg-card">
                <Shield size={16} />
                Garantía de 7 días
              </Badge>
              <Badge variant="outline" className="bg-card">
                <Mic size={16} />
                Profesor IA por voz
              </Badge>
            </div>
          </div>

          {/* Mock estrella: la ruta de Camila escribiéndose sola */}
          <div className="min-w-0 lg:col-span-6 lg:rotate-1">
            <RoutePreviewHero />
          </div>
        </div>
      </div>
    </section>
  );
}
