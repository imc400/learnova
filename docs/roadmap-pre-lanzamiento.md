# Aulia — Roadmap pre-lanzamiento ("que Platzi no envidie nada")

> Auditoría multi-agente (4 agentes: inventario del código + benchmark Platzi/Coursera/Crehana/Domestika + diseño de leaderboard + síntesis). Reporte completo: workflow `wf_6657ae28-7b7`.

## Veredicto honesto
El núcleo de ingeniería es de clase mundial (pipeline idempotente, gamificación nivel Duolingo, motor de correos que NADIE del benchmark tiene, cumplimiento YouTube blindado) y los 3 diferenciadores son reales y únicos. **PERO hoy el producto es gratis e ilimitado en la práctica** (límite free sin aplicar, compra de ruta = código muerto, un pago da Pro eterno), los fallos son invisibles (cero Sentry/analytics) y la landing promete cosas que no existen. El moat ya existe — falta la caja registradora, la capa de confianza y desplegar los fixes.

## Roadmap priorizado

### Esta semana
1. ✅ **Desplegar los fixes del fundador** (anti-Shorts, gating por quiz, coverage con contexto de ruta, reanchorLesson) + billing Gemini (activado).
2. **Techo de costos**: aplicar `FREE_PATH_LIMIT` en la creación de rutas (hoy free = rutas ilimitadas que cuestan dinero real) + rate limit y cap de tokens en /api/tutor.
3. **Checkout Flow end-to-end**: hoy la compra de ruta no se invoca desde ninguna página, pagar no desbloquea nada, CLP 13.990 da Pro eterno, FLOW_BASE_URL apunta a sandbox. Lanzar ads sin caja = quemar plata. (+ mismatch USD/CLP = riesgo SERNAC.)
4. **Higiene de promesas**: quitar "Pruebas y certificados" y "tutor con límite diario" de landing/planes hasta que existan (publicidad engañosa = riesgo SERNAC).
5. **Observabilidad**: Sentry + funnel events (PostHog) + alertas de rutas failed. Sin esto los ads son ciegos.
6. **Leaderboard semanal v1** en /app/comunidad (spec completo abajo).

### Este mes
7. **Mobile mínimo** (las navs desaparecen en móvil — el tráfico de ads es móvil) + password reset (hoy quien olvida su clave pierde la cuenta).
8. **UX de progreso en lección**: "Siguiente lección" al aprobar, x/y del módulo, chip "Quiz aprobado", markdown render.
9. **Correos de retención**: cron streak_at_risk + weekly_recap (el motor ya existe; faltan los productores) + webhook Resend.
10. **Certificado PDF** con página pública /cert/[id] — el único mínimo competitivo que falta (todos lo tienen); otorgado al APROBAR quizzes.
11. **SEO + growth loops**: robots/sitemap/OG (2h) + landing pages públicas por esqueleto canónico ("Ruta: X — personalízala con IA") = adquisición orgánica que abarata el CAC.

### Siguiente
12. **Wizard adaptativo + preview + paywall USD 9** (tarea #32) anclado contra Platzi ("tu ruta completa para siempre por menos de medio mes de Platzi").

## Ventajas únicas vs Platzi (para marketing)
- Rutas creadas a TU medida en minutos (Platzi: catálogo fijo) — "el curso de fotografía con celular para fotografiar a tu hija no existe hasta que tú lo pides".
- Video anclado al minuto + quiz que cita el video + tutor IA por lección + correos por avance con IA.
- Pago único por ruta (USD 9) vs suscripción mensual.

## Spec Leaderboard v1 (/app/comunidad)
- **Ranking semanal global** desde `xp_events.week_start` (ya existe) + pestaña all-time (`profiles.total_xp`).
- **Identidad**: nombre de pila + inicial ("Ignacio B.") o alias; avatar de iniciales; NUNCA email/apellido/goal/foto Google. "Estudiando: {topic}" (el tema, no la meta personal).
- **Default visible con opt-out de 1 clic** + alias editable (banner de transparencia primera visita). Ocultos = excluidos por completo (sin ranks fantasma).
- **Posición propia siempre visible** ("Estás #47 de 1.203"), top 3 en podio, "En ascenso" (delta de rank).
- **Datos**: ALTER profiles (leaderboard_visible default true, leaderboard_alias); índices xp_events(week_start,user_id) INCLUDE(points) y profiles(total_xp DESC) WHERE visible; P1: leaderboard_snapshots + cron lunes (congelar semana, logro "podio semanal").
- **Anti-gaming**: ledger ya idempotente + cap 300 XP/día en la query del board.
- **Acceso**: todo server-side vía Drizzle (no ampliar grants de PostgREST).
- **Anti-dark-pattern**: sin "perdiste tu puesto", sin presión; celebrar ascensos.
