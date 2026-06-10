# Pricing y costos unitarios — estudio junio 2026

Investigación multi-agente sobre el código real + precios vigentes de APIs +
mercado chileno. Resumen ejecutivo para decisiones de negocio.

## Costos unitarios (USD, peor caso razonable)

| Producto | Peor caso | Caso típico |
|---|---|---|
| Ruta FRESCA (~25 lecciones) | $4.00 | $2.60–3.20 |
| Ruta 100% cacheada | $0.01 | $0.01 |
| Módulo agregado por el profesor | $0.65 | $0.55 |
| Clase en vivo (por minuto) | $0.125 | $0.10 |
| Clase de 25 min | $3.15 | $2.50 |
| Fijos mensuales (Vercel+Supabase+Trigger+Resend+ElevenLabs Creator) | ~$97 | — |

Dominante: outputs de Sonnet en lección+quiz (~71% del costo Anthropic de una
ruta). Palancas de ahorro: quiz a Haiku (−$0.75/ruta), subir hit-rate del
caché de lecciones, bajar max_tokens efectivo.

Cuota YouTube: ~2.525 unidades/ruta fresca → ~4 rutas frescas/día con la
cuota default de 10.000 (uplift solicitado, pendiente).

## Precios vigentes (configurables por env, sin deploy)

| Env var | Valor | Producto |
|---|---|---|
| `PRICE_ROUTE_CLP` | **$9.990** | Ruta one-time (margen 62% peor caso, ~70% típico) |
| `PRICE_PRO_CLP` | **$24.990/mes** | Aulia Pro |
| `PRO_ROUTES_PER_MONTH` | **2** | Rutas nuevas incluidas en Pro |

### Aulia Pro $24.990/mes — la matemática
- Incluye: 2 rutas nuevas/mes + clases en vivo semanales + catálogo cacheado
  ilimitado + prioridad.
- Peor caso (suscriptor que usa TODO, cero caché): ~US$13.12 de costo vs
  US$26.31 de ingreso → **margen 50.1%**.
- Caso típico: costo US$5.50–7 → **margen 73–79%**.
- Breakeven de fijos: **5–6 suscriptores Pro**.
- Anclas: ChatGPT Plus ~$23.000 · Duolingo Max ~$28.500 · Platzi ~$18.300
  equiv. · profesor humano $15.000–25.000/HORA (la ancla reina del claim).

### Add-ons sugeridos (fase 2, margen ≥50%)
- Ruta extra para Pro: $7.990 · Pack 20 min de clase: $4.990 · Módulo de
  profundización del profesor: $1.990.

### Recomendaciones del estudio
1. Lanzar SOLO mensual (sin anual hasta validar churn).
2. NO prometer "ilimitado" en clases ni rutas personalizadas (rompe el
   margen del peor caso).
3. ⚠️ PENDIENTE DE DECISIÓN: cuota de clases del comprador one-time — hoy
   todo usuario tiene 30 min/semana (WEEKLY_MINUTES_LIMIT en
   src/server/actions/live.ts). Un comprador de $9.990 que use 120 min/mes
   cuesta ~$15 USD solo en clases → pérdida. Opciones: (a) ruta one-time
   incluye inducción + 1 clase de 25 min en total, clases semanales solo Pro;
   (b) mantener mientras se valida (pocos usuarios). HOY rige (b).

## Arquitectura de suscripción (Flow)
Plan `aulia_pro` creado en Flow producción ($24.990, mensual, callback
`/api/flow/subscription`). Flujo: customer → registro de tarjeta →
subscription (cobro automático) → webhook de renovación extiende
`current_period_end`. Cancelación al final del período. La fuente de verdad
SIEMPRE es la API de Flow (getPaymentStatus / subscription/get firmados).
