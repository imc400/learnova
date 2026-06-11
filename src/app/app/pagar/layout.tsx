import type { ReactNode } from "react";

/*
  Zona sobria de pago (Recetario §1.2): envoltura mínima de todo /app/pagar/*.
  Acota el ancho del flujo de decisión y garantiza que nada decorativo se
  agregue alrededor del checkout (sin stickers, sin hand, sin animaciones).

  Nota técnica: en App Router los layouts ANIDAN — el shell de /app (nav +
  chips + SupportBubble) no puede quitarse desde aquí sin re-estructurar
  rutas, y eso está prohibido (§7.1 del plan: no cambiar rutas/redirects).
  Por eso este layout NO duplica logo ni SupportBubble: ya vienen del shell.
*/
export default function PagarLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl">{children}</div>;
}
