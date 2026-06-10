/* Valida credenciales Flow: una consulta firmada inocua.
   apiKey/firma inválida → error de auth; válida → "no existe" (esperado). */
import crypto from "node:crypto";

const apiKey = process.env.FLOW_API_KEY!;
const secret = process.env.FLOW_SECRET_KEY!;
const base = process.env.FLOW_BASE_URL!;

const params: Record<string, string> = { apiKey, commerceId: "intent_validacion_aulia" };
const toSign = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
const s = crypto.createHmac("sha256", secret).update(toSign).digest("hex");
const qs = new URLSearchParams({ ...params, s }).toString();

const res = await fetch(`${base}/payment/getPaymentStatusByCommerceId?${qs}`);
const body = await res.text();
console.log("HTTP", res.status, "·", body.slice(0, 200));
process.exit(0);
