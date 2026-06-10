/* Prueba real: payment/create mínimo. Si la cuenta está activa, devuelve
   url+token (NO se cobra nada hasta que alguien pague); si no, el error
   nos dice exactamente qué falta. */
import { createPayment } from "../src/lib/payments/flow";

try {
  const p = await createPayment({
    commerceOrder: `diag_${Math.random().toString(36).slice(2, 8)}`,
    subject: "Aulia — diagnóstico de integración",
    amountCLP: 1000,
    email: "hola@grumo.app",
    urlConfirmation: "https://www.aulia.ai/api/flow/webhook",
    urlReturn: "https://www.aulia.ai/app",
  });
  console.log("OK — pago creado (nadie paga, solo diagnóstico)");
  console.log("flowOrder:", p.flowOrder, "· url:", p.redirectUrl.slice(0, 60) + "…");
} catch (e) {
  console.log("ERROR:", (e as Error).message.slice(0, 300));
}
process.exit(0);
