import { ImageResponse } from "next/og";

/*
  OG image kraft (spec §7.3): 1200×630, fondo kraft, marca Aulia en verde
  del logo (permitido aquí: es contexto de logo), tagline con «saberlo»
  sobre trazo de resaltador, y precio + dominio abajo.
  Tipografía del sistema (sin fetch de fonts).
*/

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Aulia — De querer aprenderlo a saberlo. $9.990 una vez · aulia.ai";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f1e8d3",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 132,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            color: "#0E5340",
          }}
        >
          Aulia
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            marginTop: 36,
            fontSize: 52,
            fontWeight: 600,
            color: "#23273A",
          }}
        >
          <span>De querer aprenderlo a&nbsp;</span>
          <span
            style={{
              backgroundColor: "#fce15c",
              padding: "2px 12px",
              borderRadius: 8,
            }}
          >
            saberlo
          </span>
          <span style={{ marginLeft: -8 }}>.</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 56,
            fontSize: 32,
            fontWeight: 500,
            color: "#565c71",
          }}
        >
          $9.990 una vez · aulia.ai
        </div>
      </div>
    ),
    size,
  );
}
