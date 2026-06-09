import type { ReactNode } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="container-page py-12 md:py-16">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
