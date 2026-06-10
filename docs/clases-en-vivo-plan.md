# Aulia — Clases en vivo con tu Profesor IA (arquitectura v2)

> Investigación + diseño multi-agente (4 agentes, precios verificados jun-2026).
> Reporte completo: workflow `wf_0364901f-9e6`. Reemplaza/actualiza docs/profesor-ia-plan.md.

## Decisión de stack (F1): ElevenLabs Agents + Claude nativo
- **claude-sonnet-4-6 está en el enum oficial de LLMs de ElevenLabs** → la pedagogía socrática ya afinada (TUTOR_SYSTEM) sin proxy; Haiku vía Custom LLM si costo/TTFT lo piden.
- **Costo verificado**: voz $0.08/min + LLM ≈ **$2.40 por clase de 25 min** (Sonnet ≈ $3.30; F2 LiveKit baja a ~$1.25-1.75).
- **Bilingüe es/en**: system tool "language detection" (ACTIVARLO — no viene por defecto) + voz multilingüe; ruta normal = es-CL puro; ruta de inglés = clase EN inglés con andamiaje en español (patrón Speak).
- Speed-to-market: @elevenlabs/react + agentes creables por API → "el agente se crea en el mismo formulario" = un paso más del pipeline. Cero infra nueva.
- **Lock-in bajo**: persona/memoria/currículo viven en Supabase; interfaz `VoiceProvider` propia → migración F3 a LiveKit (Deepgram + Claude + misma voz ElevenLabs, -40% costo, + pantalla compartida) sin tocar UI ni pedagogía.
- Descartados: Vapi/Retell (peaje $3.30-9.90/clase), OpenAI Realtime (GPT como cerebro + costo volátil; queda como benchmark A/B).

## Arquitectura (componentes P0)
1. **`VoiceProvider`** (src/lib/live/provider.ts) — interfaz propia; impl. ElevenLabs (CRUD agentes + signed URL para useConversation).
2. **Persona del profesor EN la generación** — Haiku deriva nombre/especialidad/estilo/saludo/system-prompt desde skeleton+intake → `route_agents` (cacheKey=skeletonCacheKey, compartida) + copia en learning_paths. Aprobación del fundador de 5-10 personas antes del backfill.
3. **Brief de memoria pre-clase** (src/lib/live/brief.ts, 300-500 tokens, server-derivado): módulos completados, errores concretos de quizzes (feedback ya guardado), racha/XP, meta del intake, resumen de última clase + tareas y si las hizo. **Primeros 2 turnos GUIONIZADOS** ("La clase pasada te trabaste en lookalikes — ¿hiciste los 3 ejercicios?").
4. **`startClassAction` + aula /app/aula/[sessionId]** — valida cupo de MINUTOS server-side, crea live_sessions, inyecta brief, devuelve signed URL; UI con timer de fase + disclaimer "es una IA".
5. **Server tools** (/api/live/tools/*): get_student_progress, assign_homework, end_class — HMAC + token por sesión (jamás confiar en IDs que diga el LLM).
6. **Arco NSSA de 6 fases / 25 min** como máquina de estados en el prompt: apertura con memoria 2' → revisión de tarea 4' → objetivo 1' → mini-lección socrática 8' → práctica con retrieval (nunca dar la respuesta) → cierre metacognitivo + tareas. Corte ritual a los 25', nunca timeout seco.
7. **Job post-clase** (Trigger: summarize-class): Haiku destila transcripción → resumen + tareas (3-5 retrieval + 1 aplicada) → learner_profiles (merge) → **email class_summary** por el outbox existente (exento de frequency cap) + .ics de próxima clase.
8. **Cupos duros + kill-switch**: minutos por semana/mes server-side; máx 30 min con cierre ritual; LIVE_CLASSES_ENABLED flag. Beta sin pagos: 1 clase/semana universal.
9. **Legal (bloquea lanzamiento, no desarrollo)**: la voz es dato biométrico bajo Ley 21.719 — reescribir política (hoy NIEGA biométricos), consentimiento explícito en el aula, gate >18, no se graba audio (solo transcripción/resumen), asesoría antes de ads.

## Datos nuevos
`route_agents` (persona por esqueleto) · `live_sessions` (scheduled_at, status, duration_sec, summary, exit_ticket) · `homework_items` (tareas con reviewed) · `learner_profiles` (perfil/memoria por usuario-ruta) · email_type +class_summary/+class_reminder.

## Calendario (F2 — pedido explícito)
Propio y simple (la IA está 24/7 — sin "disponibilidad"): agendar/reagendar/cancelar sobre live_sessions + .ics + recordatorios 24h y 1h vía tasks one-off de Trigger (guardar run_id para cancelar al reagendar) + missed a los 15 min. **NO Cal.com** ($16-37/usuario/mes para resolver conflictos que una IA no tiene). F4: recordatorio 1h por WhatsApp (apertura 91% vs 21%).

## Economía y gating (pagos pospuestos; diseño listo)
- FREE: 1 clase de PRUEBA de 15 min (~$1.40 una vez — gancho del funnel de ads).
- PRO $15: 2 clases/mes (~$4.80 = 32% del precio en F1; 17-23% tras LiveKit).
- Futuro TUTOR $29: 1 clase/semana (entre Duolingo Max $29.99 y Speak $40-60) + packs extra $2.99.
- Plan ElevenLabs: Creator $22/mes (275 min ≈ 11 clases) para beta → Pro $99 (1.238 min ≈ 49) al lanzar ads.

## Fases
- **F0 Spike (3-5 días)**: cuenta ElevenLabs + escucha ciega de 3 voces con chilenos + agente manual de prueba con brief real + validar language-detection es↔en.
- **F1 Núcleo (1.5-2 sem)**: todo lo P0 de arriba, on-demand (sin calendario).
- **F2 Calendario + ritual (1-1.5 sem)**.
- **F3 LiveKit + pantalla compartida (condicional a >~3.000 min/mes)**.
- **F4 Extensiones con datos**: práctica de 5 min on-demand, WhatsApp, homework→FSRS, avatar.

## Acciones del fundador (en orden)
1. **HOY (bloquea F0)**: cuenta elevenlabs.io → plan Creator $22 → API key → pasármela (va a Vercel + worker + .env).
2. F0: preseleccionar 3 voces multilingües con español LatAm de la Voice Library (escucha ciega con 10-20 chilenos).
3. F1: secreto de webhooks del workspace → ELEVENLABS_WEBHOOK_SECRET.
4. Aprobar 5-10 personas de profesor generadas (la "voz de marca").
5. Legal Chile (Ley 21.719) antes de ads — la política actual NIEGA biométricos y la voz lo es.
6. LiveKit/Deepgram: NO crear aún (F3). WhatsApp Business: opcional F4.

## Hardening heredado (P1, hacerlo con F1)
/api/tutor de texto: cachedSystem + max_tokens + rate-limit + contexto derivado en servidor desde lessonId (hoy llega crudo del cliente = prompt injection). Mismo patrón de brief que el aula.
