import type { Metadata } from "next";
import { Fredoka, Nunito_Sans } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

// Texto (UI/cuerpo): Nunito Sans — humanista, legible, con ñ y acentos.
const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

// Display (titulares): Fredoka — redondeada, cálida, cercana.
const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  openGraph: {
    type: "website",
    locale: "es_CL",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    siteName: site.name,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${nunito.variable} ${fredoka.variable}`}>
      <body>{children}</body>
    </html>
  );
}
