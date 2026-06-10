/* Diagnóstico del flujo de suscripción: customer/create + customer/register
   con datos de prueba — muestra el error EXACTO de Flow si algo falla. */
import { createCustomer, registerCard } from "../src/lib/payments/flow";

const stamp = Math.random().toString(36).slice(2, 8);
try {
  const c = await createCustomer({
    name: "Diagnóstico Aulia",
    email: `diag.aulia.${stamp}@gmail.com`,
    externalId: `diag_${stamp}`,
  });
  console.log("✓ customer/create OK →", c.customerId);
  try {
    const r = await registerCard({
      customerId: c.customerId,
      urlReturn: "https://www.aulia.ai/api/flow/card-return",
    });
    console.log("✓ customer/register OK →", r.redirectUrl.slice(0, 70) + "…");
  } catch (e) {
    console.log("✗ customer/register FALLÓ:", (e as Error).message.slice(0, 300));
  }
} catch (e) {
  console.log("✗ customer/create FALLÓ:", (e as Error).message.slice(0, 300));
}
process.exit(0);
