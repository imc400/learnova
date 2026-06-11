# Runbook — correos de ciclo de vida (LIFECYCLE_EMAILS_ENABLED)

> Por qué existe este runbook: la promesa **"te avisamos para renovar"** vive en
> 6+ superficies de la UI (planes, perfil, pagar/[intentId], precios, FAQ y el
> prompt de soporte), pero el sistema que la cumple (pro-renewal-reminder D-3/D0
> + cart-recovery T+1h/T+24h) nace APAGADO: `LIFECYCLE_EMAILS_ENABLED` tiene
> default `"false"` (src/lib/env.ts / .env.example). Mergear la rama NO hace
> verdadera la promesa — encender el flag con este checklist, sí.

## El flag vive en DOS lados

| Dónde | Qué gobierna | Cómo se cambia |
| --- | --- | --- |
| **Vercel** (env del proyecto) | La app Next.js | Dashboard de Vercel + redeploy (o redeploy de envs) |
| **Trigger.dev** (env del environment) | Los crons (`pro-renewal-reminder`, `cart-recovery`) **y el envío** (`send-progress-email` → process.ts) corren EN el worker | Dashboard de Trigger.dev → cambio **sin deploy**. Alternativa: redeploy de Trigger (la var está en `syncEnvVars`, trigger.config.ts) |

OJO: `syncEnvVars` solo sube las envs de Vercel al worker **en cada deploy de
Trigger**. Cambiar la variable solo en Vercel NO afecta al worker hasta el
próximo deploy — para encender/apagar al instante hay que tocarla en el
dashboard de Trigger.dev.

## Checklist de ENCENDIDO (post-aprobación de copys)

1. **Vercel** → `LIFECYCLE_EMAILS_ENABLED=true` + redeploy.
2. **Trigger.dev** → la misma var `=true` en el environment de producción
   (dashboard, sin deploy) — o redeploy de Trigger si prefieres que la arrastre
   `syncEnvVars`.
3. **Verificar** en la siguiente corrida del cron (10:00 America/Santiago para
   renovaciones; cada hora para carros) que el log diga `encolados` en vez de
   `LIFECYCLE_EMAILS_ENABLED=false`.

Nota de borde al encender: los Pro a **<24 h** del vencimiento reciben
únicamente el toque D0; los de **24–72 h** sí reciben el D-3 (tardío). Nadie
con >72 h se pierde nada.

## Checklist de APAGADO (kill-switch)

1. **Trigger.dev** → `LIFECYCLE_EMAILS_ENABLED=false` en el dashboard (sin
   deploy: es el lado que detiene el envío real).
2. **Vercel** → misma var en `false` para mantener coherencia.

Comportamiento garantizado por process.ts (gate EN EL PUNTO DE ENVÍO, además
del gate de encolado de los crons): con el flag apagado, todo `pro_expiring` /
`cart_recovery` / `reengagement` ya encolado se marca **skipped (terminal)** —
incluido lo que el paso 6 de reconcile.ts re-dispara. Decisión consciente: lo
gateado **NO se envía al re-encender** (apagar significa "esto no debe salir",
no "esto sale después").
