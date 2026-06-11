import {
  Body,
  Button,
  Container,
  Font,
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
  Plantilla única de correos de avance — tema "Cuaderno" (autodidacta):
  papel kraft, tinta azul-negra, RESALTADOR amarillo en lo importante y el
  logo de Aulia (versión email-safe: squircle verde + barras de voz).
  El CONTENIDO (subject/intro/bullets/cta) viene generado por Haiku y
  post-validado; esta plantilla solo da la forma y la marca.
*/

const palette = {
  paper: "#F1E8D3", // kraft de cuaderno
  ink: "#23273A", // tinta de lápiz pasta
  green: "#1F7A63",
  greenDark: "#0E5340", // verde del logo (bloqueado)
  logoAmber: "#F2A65A", // barra ámbar del logo (bloqueada)
  highlight: "#FCE15C", // resaltador
  coral: "#D85A3F", // lápiz rojo
  muted: "#565C71",
  card: "#FCF9F0", // página
  border: "#DBCFB3",
};

/** Logo email-safe: squircle verde con las 4 barras de voz (sin SVG). */
function EmailLogo() {
  const bar = (h: number, color: string): React.CSSProperties => ({
    display: "inline-block",
    width: 7,
    height: h,
    borderRadius: 4,
    backgroundColor: color,
    margin: "0 2px",
    verticalAlign: "middle",
  });
  return (
    <table align="center" role="presentation" cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr>
          <td
            style={{
              backgroundColor: palette.greenDark,
              borderRadius: 18,
              width: 56,
              height: 56,
              textAlign: "center" as const,
              verticalAlign: "middle",
            }}
          >
            <span style={bar(16, "#FAF6EE")} />
            <span style={bar(30, palette.logoAmber)} />
            <span style={bar(22, "#FAF6EE")} />
            <span style={bar(11, "#FAF6EE")} />
          </td>
          <td style={{ paddingLeft: 12 }}>
            <span
              style={{
                fontFamily: "'Fredoka', 'Nunito Sans', Arial, sans-serif",
                fontSize: 26,
                fontWeight: 700,
                color: palette.greenDark,
                letterSpacing: -0.5,
              }}
            >
              Aulia
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export interface ProgressEmailProps {
  preview: string;
  badge?: string; // "Módulo completado", "Ruta completada ✺", "Nuevo módulo disponible"
  heading: string;
  intro: string;
  bullets: string[];
  bulletsTitle?: string;
  /** Marca de cada bullet: "✓" (logro, default) o "🔒" (temario reservado del
   *  carro abandonado — idéntico al candado del paywall, consistencia total). */
  bulletIcon?: string;
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
  bulletIcon = "✓",
  cta,
  secondaryCta,
  stats,
  unsubscribeUrl,
}: ProgressEmailProps) {
  return (
    <Html lang="es">
      <Head>
        {/* Tipografías de marca con fallback seguro (Outlook ignora @font-face). */}
        <Font
          fontFamily="Fredoka"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://fonts.gstatic.com/s/fredoka/v17/X7nP4b87HvSqjb_WIi2yDCRwoQ_k7367_B-i2yQag0-mac3OLyX8EemKttxNbikt.woff2",
            format: "woff2",
          }}
          fontWeight={600}
          fontStyle="normal"
        />
        <Font
          fontFamily="Nunito Sans"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://fonts.gstatic.com/s/nunitosans/v19/pe0TMImSLYBIv1o4X1M8ce2xCx3yop4tQpF_MeTm0lfUVwoNnq4CLz0_upHZPYsZ51Q42ptCprt1R-tQKr51.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
        {/* El cuaderno es kraft claro: evitar inversión de dark mode. */}
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: palette.paper, margin: 0, padding: "24px 12px", fontFamily: "'Nunito Sans', 'Segoe UI', Arial, sans-serif" }}>
        <Container style={{ maxWidth: 520, margin: "0 auto" }}>
          {/* Marca (logo bloqueado: verde + ámbar, pase lo que pase) */}
          <Section style={{ textAlign: "center" as const, paddingBottom: 18 }}>
            <EmailLogo />
          </Section>

          <Section style={{ backgroundColor: palette.card, borderRadius: 16, border: `1px solid ${palette.border}`, padding: "32px 28px" }}>
            {badge && (
              <Text style={{ display: "inline-block", backgroundColor: palette.highlight, color: "#5A4A05", borderRadius: "4px 4px 4px 0", padding: "4px 14px", fontSize: 13, fontWeight: 800, margin: "0 0 14px" }}>
                {badge}
              </Text>
            )}
            <Heading style={{ color: palette.ink, fontSize: 24, lineHeight: "30px", margin: "0 0 10px", fontWeight: 800, fontFamily: "'Fredoka', 'Nunito Sans', Arial, sans-serif" }}>
              {heading}
            </Heading>
            <Text style={{ color: palette.muted, fontSize: 15, lineHeight: "23px", margin: "0 0 18px" }}>
              {intro}
            </Text>

            {bullets.length > 0 && (
              <Section style={{ backgroundColor: palette.paper, borderRadius: 12, padding: "16px 18px", marginBottom: 20, borderLeft: `3px solid ${palette.highlight}` }}>
                <Text style={{ color: palette.greenDark, fontSize: 13, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: 0.6, margin: "0 0 8px" }}>
                  {bulletsTitle}
                </Text>
                {bullets.map((b, i) => (
                  <Text key={i} style={{ color: palette.ink, fontSize: 14, lineHeight: "21px", margin: "0 0 6px" }}>
                    <span style={{ color: palette.green, fontWeight: 800 }}>{bulletIcon}</span>{" "}
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
              style={{ backgroundColor: palette.green, color: "#FFFFFF", borderRadius: 14, padding: "12px 26px", fontSize: 15, fontWeight: 800, textDecoration: "none", display: "inline-block", boxShadow: "0 2px 6px rgba(35, 39, 58, 0.14)" }}
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
            De querer aprenderlo a{" "}
            <span style={{ backgroundColor: palette.highlight, padding: "0 3px", borderRadius: 2, color: palette.ink, fontWeight: 700 }}>
              saberlo
            </span>
            . Recibes este correo porque tienes una cuenta en{" "}
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
