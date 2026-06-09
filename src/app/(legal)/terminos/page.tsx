import type { Metadata } from "next";
import { LegalContent } from "@/components/legal-content";
import { TERMS_MD } from "@/content/legal";

export const metadata: Metadata = {
  title: "Términos y Condiciones",
  description: "Términos y condiciones de uso de Aulia.",
};

export default function TerminosPage() {
  return <LegalContent markdown={TERMS_MD} />;
}
