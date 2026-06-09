# Aulia — Plan de Engagement + Motor de Correos por Avance

> Investigación + diseño multi-agente (6 agentes, con fuentes). Filosofía **White Hat / anti-dark-pattern** como diferenciador de marca. Construido SOBRE el código real, no de cero.

---

## 0. Qué ya existe (auditoría del código)

| Área | Estado hoy |
|---|---|
| **Progreso por lección** | ✅ Tabla `progress` (status not_started/in_progress/completed, score sin usar). Único(userId,lessonId). |
| **Marcado de completado** | ⚠️ SOLO manual (botón en la lección → `completeLessonAction`). Aprobar el quiz **NO** marca progreso. |
| **Quizzes** | ✅ `gradeQuizAction` (umbral passed ≥ 0.6) → `quiz_attempts`. No alimenta nada más. |
| **% de avance en la UI** | ❌ No existe. El dashboard y la página de ruta NO leen `progress`. **El check verde refleja contenido GENERADO, no que el usuario completó** (bug de percepción). |
| **`generationProgress`** | ℹ️ Es progreso de GENERACIÓN por IA (0-100), NO de aprendizaje. No confundir. |
| **Gamificación** | ❌ Nada (sin XP, puntos, logros, rachas, leaderboard). |
| **Email** | ❌ Sin infra propia (no Resend/react-email). Solo los correos de Supabase Auth. Todo a construir. |
| **Trigger.dev v4** | ✅ Patrón listo: `task()` (generate-path) + `schedules.task()` (refresh-videos). Reusar. |
| **Usuario** | `profiles` (id = auth.users.id, `locale` es-CL). Email vive en auth.users (no en profiles). Trigger `handle_new_user` crea profile + subscription. RLS activo. |

---

## 1. Sistema de Engagement (mapeado a Self-Determination Theory)

**Cinco capas** (autonomía + competencia + relación):

1. **Progreso multinivel, nunca 0%** — % por ruta y por módulo leyendo `progress`; arrancar con el onboarding ya "hecho" (*endowed progress*, Nunes & Drèze 2006) y mostrar "te falta 1 lección para cerrar el módulo" (*goal-gradient*, Kivetz 2006). El check verde pasa a reflejar completado por el usuario.
2. **XP atado a DOMINIO** — lección completada, quiz aprobado, módulo y ruta terminados. Ledger idempotente `xp_events` + `total_xp`/`level` en profiles. XP por logro, **nunca por tiempo** (evita *overjustification*, Deci-Ryan 1999).
3. **Logros** — pocos y significativos (deterministas) + alguna sorpresa.
4. **Racha con válvula de escape** — `streak_freeze` (2 gratis) + meta flexible ("1 lección O 10 min") + racha semanal opcional. Duolingo: +14% retención D7 con streak; freeze redujo churn 21%. **Nunca racha sin freeze** (ansiedad → churn).
5. **Ligas opt-in por cohortes de ~30** — reseteo semanal (cron lunes), premiar **movimiento**, ocultar el fondo, alias (sin PII). Nunca ranking global aplastante.

### Tablas nuevas (Drizzle, `db:generate` + `db:migrate`)
- `profiles` ALTER: `total_xp, level, current_streak, longest_streak, last_active_day, streak_freezes, leaderboard_opt_in, leaderboard_alias, email`
- `xp_events` (ledger; unique(user_id, source, ref_id) → **idempotencia**)
- `achievements` (catálogo) + `user_achievements` (unique(user_id, achievement_id))
- `leagues` + `league_members` (cohortes semanales)

### Arquitectura
- **Síncrono** (server actions `completeLessonAction`/`gradeQuizAction`, en una `db.transaction`): upsert progress (**auto-completar lección al aprobar quiz**), insert xp_events `onConflictDoNothing`, incrementar total_xp/level, actualizar racha, detectar módulo/ruta cerrados.
- **Asíncrono** (Trigger.dev): generar+enviar correos, recomputar ligas (cron lunes), nudges por inactividad.

---

## 2. Motor de Correos por Avance (la feature estrella)

**Event-driven + idempotente + anclado a datos reales.** Proveedor recomendado: **Resend + React Email** (todo en código, mejor DX para Next, DKIM por dominio; la orquestación la hace Trigger.dev que ya tienes). Loops = alternativa si se quiere menos código.

### Tipos de correo
| Correo | Disparador | Prioridad |
|---|---|---|
| Bienvenida (lleva a completar 1ª lección) | crear cuenta | P0 |
| **Nuevo módulo listo** | generación progresiva termina un módulo | P0 |
| **"Esto aprendiste"** (resumen IA, estrella) | usuario cierra un módulo | P0 |
| Racha en riesgo | 23.5h tras última sesión, corte día 7 | P1 |
| Recap semanal (% avance, XP, liga) | cron semanal | P1 |
| Re-engagement / win-back | inactividad de semanas | P2 |
| Ruta completada | 100% de la ruta | P2 |

### Cómo se genera "esto aprendiste" (anti-alucinación)
Anthropic `messages.parse` + `zodOutputFormat`, schema `{asunto, intro, bullets[], cta}`. Contexto = **SOLO** títulos reales de lecciones/módulo + scores reales. **Hechos = restricción dura, tono cálido es-CL = libre.** Post-validación: cada bullet referencia contenido presente y ningún elogio contradice el score → si falla, fallback a plantilla determinista. **Nunca felicitar por un quiz no aprobado.**

### Tablas nuevas
- `email_outbox` (insertado en la MISMA transacción que el progreso → sin dual-write; unique(userId, type, dedupeKey) → effectively-once)
- `email_preferences` (opt-out granular por tipo, `maxPerWeek` 2-3, `timezone`, `unsubToken`)
- `email_log` (envíos + webhooks Resend: open/click/bounce/complaint; complaint → unsub)

### Entregabilidad
Subdominio dedicado **mail.aulia.ai** con SPF/DKIM/DMARC (p=none → quarantine/reject en <4 sem). **Pool transaccional (auth) separado del de ciclo de vida** para no arrastrar el login a spam (Gmail feb-2024, Outlook may-2025 lo exigen).

---

## 3. Roadmap unificado (orden recomendado)

| Fase | Qué | Esfuerzo | Riesgo |
|---|---|---|---|
| **0** | **Progreso real visible** — % por ruta/módulo, auto-completar lección al aprobar quiz, check verde = completado, nunca 0%. **Fundacional, desbloquea todo.** | ~1 sem | Bajo |
| **1** | **XP + niveles + logros + detección de hitos** (módulo/ruta cerrados emiten evento). | ~1-1.5 sem | Medio |
| **2** | **Correos por avance** (Resend + react-email; onboarding, módulo listo, "esto aprendiste") + entregabilidad mail.aulia.ai. | ~2 sem (+warming) | Medio-alto |
| **3** | **Racha** con freeze + meta flexible + correo "racha en riesgo". | ~1 sem | Medio |
| **4** | **Ligas + recap semanal + win-back.** | ~2 sem | Medio |

---

## 4. Guardrails (no negociables)
- Anti-dark-pattern explícito (diferenciador vs críticas a Duolingo): recordatorios respetuosos y desactivables, sin coacción, sin monetizar la ansiedad de racha.
- Racha SIEMPRE con freeze + meta flexible.
- XP por dominio, no por tiempo; pocos badges significativos.
- Leaderboards: opt-in, cohortes ~30, premiar movimiento, alias, sin PII (vista SECURITY DEFINER).
- Idempotencia obligatoria (Trigger.dev = at-least-once): unique en xp_events, user_achievements, email_outbox/log; escrituras en `db.transaction`.
- Correos IA: grounding + post-validación; nunca elogiar logros falsos.
- Frequency cap 2-3/sem; corte de re-engagement al día 7; opt-out de 1 clic (CAN-SPAM/GDPR).
- Medir **finalización real y hábito temprano** (CURR-like), no solo DAU (detectar "gamificación vacía").

## 5. Decisiones abiertas
- Fórmula exacta XP→nivel (tunear con datos).
- Gating free vs Pro (¿ligas/correos solo Pro o todo gratis para maximizar engagement?).
- Resend vs Loops (build-vs-buy de la capa lifecycle).
- Modelo Anthropic para correos (Haiku barato vs Sonnet) + cache para módulos idénticos.
- "Día activo" de la racha y manejo de husos horarios LatAm.
- ¿Push/in-app además del correo (multicanal +retención) ahora o después?
