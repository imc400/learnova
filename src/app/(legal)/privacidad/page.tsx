import type { Metadata } from "next";
import { LegalContent } from "@/components/legal-content";
import { PRIVACY_MD } from "@/content/legal";

export const metadata: Metadata = {
  title: "Política de Privacidad",
  description:
    "Cómo Learnova recopila, usa y protege tus datos, incluido el uso de los Servicios de la API de YouTube.",
};

export default function PrivacidadPage() {
  return <LegalContent markdown={PRIVACY_MD} />;
}
