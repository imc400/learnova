import { Resend } from "resend";
import { env } from "@/lib/env";

/*
  Cliente Resend (lazy, igual que getAnthropic): el worker de Trigger.dev y las
  server actions lo comparten. Sin RESEND_API_KEY el motor queda apagado
  (los correos se saltan con status 'skipped', nunca rompen el flujo).
*/

let _resend: Resend | null = null;

export function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

export function emailFrom(): string {
  return env.EMAIL_FROM;
}
