import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/*
  Plantilla única de correos de avance (Sage & Cream, email-safe inline styles).
  El CONTENIDO (subject/intro/bullets/cta) viene generado por Haiku y
  post-validado; esta plantilla solo da la forma y la marca.
*/

const palette = {
  paper: "#FAF6EE",
  ink: "#16261F",
  green: "#1F7A63",
  greenDark: "#0E5340",
  amber: "#F2A65A",
  muted: "#5C6B63",
  card: "#FFFFFF",
  border: "#E6DDCC",
};

export interface ProgressEmailProps {
  preview: string;
  badge?: string; // "🏁 Módulo completado", "🏆 Ruta completada", "✨ Nuevo módulo"
  heading: string;
  intro: string;
  bullets: string[];
  bulletsTitle?: string;
  cta: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  stats?: { label: string; value: string }[];
  unsubscribeUrl: string;
}

export function ProgressEmail({
  preview,
  badge,
  heading,
  intro,
  bullets,
  bulletsTitle = "Esto aprendiste",
  cta,
  secondaryCta,
  stats,
  unsubscribeUrl,
}: ProgressEmailProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: palette.paper, margin: 0, padding: "24px 12px", fontFamily: "'Nunito Sans', 'Segoe UI', Arial, sans-serif" }}>
        <Container style={{ maxWidth: 520, margin: "0 auto" }}>
          {/* Marca */}
          <Section style={{ textAlign: "center" as const, paddingBottom: 16 }}>
            <Text style={{ fontSize: 22, fontWeight: 800, color: palette.greenDark, margin: 0, letterSpacing: -0.5 }}>
              Aulia
            </Text>
          </Section>

          <Section style={{ backgroundColor: palette.card, borderRadius: 16, border: `1px solid ${palette.border}`, padding: "32px 28px" }}>
            {badge && (
              <Text style={{ display: "inline-block", backgroundColor: "#1F7A6315", color: palette.green, borderRadius: 999, padding: "4px 14px", fontSize: 13, fontWeight: 700, margin: "0 0 14px" }}>
                {badge}
              </Text>
            )}
            <Heading style={{ color: palette.ink, fontSize: 24, lineHeight: "30px", margin: "0 0 10px", fontWeight: 800 }}>
              {heading}
            </Heading>
            <Text style={{ color: palette.muted, fontSize: 15, lineHeight: "23px", margin: "0 0 18px" }}>
              {intro}
            </Text>

            {bullets.length > 0 && (
              <Section style={{ backgroundColor: palette.paper, borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
                <Text style={{ color: palette.greenDark, fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: 0.6, margin: "0 0 8px" }}>
                  {bulletsTitle}
                </Text>
                {bullets.map((b, i) => (
                  <Text key={i} style={{ color: palette.ink, fontSize: 14, lineHeight: "21px", margin: "0 0 6px" }}>
                    <span style={{ color: palette.green, fontWeight: 800 }}>✓</span>{" "}
                    {b}
                  </Text>
                ))}
              </Section>
            )}

            {stats && stats.length > 0 && (
              <Section style={{ marginBottom: 20 }}>
                {stats.map((s, i) => (
                  <Text key={i} style={{ display: "inline-block", border: `1px solid ${palette.border}`, borderRadius: 999, padding: "4px 12px", fontSize: 12.5, fontWeight: 700, color: palette.greenDark, margin: "0 6px 6px 0" }}>
                    {s.label}: {s.value}
                  </Text>
                ))}
              </Section>
            )}

            <Button
              href={cta.url}
              style={{ backgroundColor: palette.green, color: "#FFFFFF", borderRadius: 999, padding: "12px 26px", fontSize: 15, fontWeight: 800, textDecoration: "none", display: "inline-block" }}
            >
              {cta.label}
            </Button>
            {secondaryCta && (
              <Text style={{ margin: "14px 0 0", fontSize: 14 }}>
                <Link href={secondaryCta.url} style={{ color: palette.green, fontWeight: 700 }}>
                  {secondaryCta.label} →
                </Link>
              </Text>
            )}
          </Section>

          <Hr style={{ borderColor: palette.border, margin: "24px 0 12px" }} />
          <Text style={{ color: palette.muted, fontSize: 12, lineHeight: "18px", textAlign: "center" as const }}>
            Recibes este correo porque tienes una cuenta en{" "}
            <Link href="https://aulia.ai" style={{ color: palette.green }}>
              aulia.ai
            </Link>
            .{" "}
            <Link href={unsubscribeUrl} style={{ color: palette.muted, textDecoration: "underline" }}>
              Dejar de recibir estos correos
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ProgressEmail;
