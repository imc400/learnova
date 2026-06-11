import type { Metadata } from "next";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Hero } from "@/components/marketing/landing/hero";
import { MarqueeTemas } from "@/components/marketing/landing/marquee-temas";
import { ActoUno } from "@/components/marketing/landing/acto-uno";
import { Bisagra } from "@/components/marketing/landing/bisagra";
import { CapituloRuta } from "@/components/marketing/landing/capitulo-ruta";
import { CapituloVideos } from "@/components/marketing/landing/capitulo-videos";
import { CapituloProfesor } from "@/components/marketing/landing/capitulo-profesor";
import { CapituloAvance } from "@/components/marketing/landing/capitulo-avance";
import { CapituloCaminos } from "@/components/marketing/landing/capitulo-caminos";
import { RecapLedger } from "@/components/marketing/landing/recap-ledger";
import { ComoParto } from "@/components/marketing/landing/como-parto";
import { Precios } from "@/components/marketing/landing/precios";
import { Faq } from "@/components/marketing/landing/faq";
import { CtaFinal } from "@/components/marketing/landing/cta-final";
import { CtaDock } from "@/components/marketing/landing/cta-dock";

/*
  Landing «Tachado y Subrayado» — la vieja forma de aprender, tachada con
  lápiz rojo; la nueva, subrayada con destacador. Un solo client component
  (Reveal); todo lo demás es server + CSS. El hilo narrativo (Camila y su
  ruta de fotografía) atraviesa todos los mocks.
*/

export const metadata: Metadata = {
  title: "Aulia — De querer aprenderlo a saberlo",
  description:
    "Dinos qué quieres aprender y la IA diseña una ruta solo para ti: videos marcados al minuto, quizzes que prueban dominio y un profesor con voz que recuerda tu avance. $9.990 una vez.",
};

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <div className="scroll-progress" aria-hidden="true" />
      <main>
        <Hero />
        {/* Wrapper del dock sticky: pega el CTA mobile desde que el hero sale. */}
        <div className="relative">
          <MarqueeTemas />
          <ActoUno />
          <Bisagra />
          <CapituloRuta />
          <CapituloVideos />
          <CapituloProfesor />
          <CapituloAvance />
          <CapituloCaminos />
          <RecapLedger />
          <ComoParto />
          <Precios />
          <Faq />
          <CtaFinal />
          <CtaDock />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
