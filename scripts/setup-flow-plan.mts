/* Crea el plan de suscripción Pro en Flow (UNA vez por ambiente).
   Uso: npx tsx --env-file=.env scripts/setup-flow-plan.mts */
import { createPlan } from "../src/lib/payments/flow";

const amount = Number(process.env.PRICE_PRO_CLP ?? 24990);
const planId = process.env.FLOW_PLAN_ID ?? "aulia_pro";

try {
  const plan = await createPlan({
    planId,
    name: "Aulia Pro",
    amountCLP: amount,
    urlCallback: "https://www.aulia.ai/api/flow/subscription",
  });
  console.log(`✓ Plan creado: ${plan.planId} · $${amount} CLP/mes · status ${plan.status}`);
} catch (e) {
  const msg = (e as Error).message;
  if (msg.includes("already") || msg.includes("exist")) {
    console.log(`Plan ${planId} ya existía — OK.`);
  } else {
    console.error("ERROR:", msg);
    process.exit(1);
  }
}
process.exit(0);
