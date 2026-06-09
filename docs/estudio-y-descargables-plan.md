# Aulia — Sistema de Estudio + Descargables ("Study Kit")

> Investigación + diseño multi-agente (5 agentes, ~985k tokens, con fuentes y auditoría del código).
> Reporte completo: workflow `wf_31813e24-b42`. Complementa `docs/engagement-y-correos-plan.md`.

---

## 🎯 Las 3 decisiones estratégicas (en las que convergieron ambos arquitectos)

### 1. CERO IA de imagen para artefactos con texto
El texto en español perfecto (acentos, ñ) es requisito duro y los píxeles no se editan.
**Pipeline programático:** Claude genera solo el **contenido estructurado** (validado con Zod) → se inyecta en **4-5 plantillas HTML/SVG fijas** con el design system Sage & Cream (verde #1F7A63, crema #FAF6EE, Fredoka/Nunito como @font-face) → **Chromium en Trigger.dev** renderiza a PDF/PNG → Supabase Storage.
- Pack completo programático: **~$0.46/esqueleto** (~$0.26 con Batch API)
- El mismo pack 100% con IA de imagen (Nano Banana Pro $0.134 × ~31 imágenes): **~$4.15 — 9× más caro, con typos no editables**
- IA de imagen (Imagen 4 Fast, $0.02/img) queda SOLO para 1 ilustración decorativa **sin texto** por esqueleto (Fase 3, premium).

### 2. `lesson_content_cache` — el prerequisito que se paga solo
Hoy **cada usuario del mismo tema re-paga Sonnet** por las ~24 lecciones (~$1.0-1.5/ruta repetida). Extender el patrón `skeleton_cache` al CONTENIDO de lección:
- Cache key: `(skeletonCacheKey, moduleIndex, lessonIndex, version)`, HIT/MISS antes de `generateLessonContent` en `run.ts`.
- Hace canónicos y compartibles: contenido, flashcards, diagramas y PDFs.
- **Bonus decisivo: el ahorro de Sonnet paga el sistema de estudio completo.** Rutas repetidas pasan a generarse casi instantáneo (mejor UX).

### 3. Todo lo caro se genera UNA vez POR ESQUELETO; solo el ESTADO es por usuario
- Compartido (por cacheKey): contenido, mazos de tarjetas, diagramas, cheat sheets, workbook, mapa de ruta.
- Por usuario (≈$0): estado FSRS de repaso, certificado con nombre (re-render sin tokens), resumen de avance.
- Escala: 40% hit-rate a 10 rutas/día → 90% a 1000/día (`timesReused` ya lo mide).

---

## 📚 Plan A — Sistema de Estudio ("Motor de Dominio")

La única combinación con evidencia ALTA en ciencia del aprendizaje: **recuperación activa + repaso espaciado** (successive relearning). Aulia ya tiene el 70% de la infra (quizzes, progress, xp_events, racha, pipeline).

| Pieza | Qué es | Generación | Prioridad |
|---|---|---|---|
| `lesson_content_cache` | Contenido canónico por esqueleto | Sin LLM nuevo; HIT/MISS en run.ts | **P0** |
| **Flashcards por esqueleto** | 8-12 tarjetas atómicas/lección (cloze + Q&A, reglas de Wozniak), derivadas de keyTakeaways/sections/quiz ya pagados (anti-alucinación: fuente controlada) | Haiku ~$0.009/lección → **~$0.22/esqueleto**, una vez | **P0** |
| **Motor FSRS** (`ts-fsrs`, MIT) | El scheduler de Anki/RemNote: 20-30% menos repasos que SM-2 para igual retención — clave para adultos ocupados. 4 ratings: Otra vez/Difícil/Bien/Fácil | $0 (TS puro en server actions) | **P0** |
| **"Repaso de Hoy"** (`/app/repaso`) | Sesión cerrada ~5 min, máx 15 ítems: vencidas FSRS + errores de quiz reciclados + interleaving. XP idempotente (source `review_session`) + sostiene la racha. **LA sesión que cabe en cualquier día** | $0 marginal | **P0** |
| Quiz de módulo acumulativo | ~60% módulo actual + 40% anteriores (interleaving; evidencia 77% vs 38% en test diferido). Copy de fricción deseable | ≈$0 (query + ajuste de prompt) | P1 |
| **Dominio** (successive relearning) | "Dominado" = 3 recuperaciones correctas en días distintos (Rawson & Dunlosky). Anillos por módulo, % dominio junto a % avance, achievement "Dominio total" | $0 (lógica sobre review_logs) | P1 |
| Diagramas dual-coding por lección | SVG con texto real (flujo/comparación/mapa según contenido) | Sonnet spec ~$0.029/lección, por esqueleto | P2 |
| Tutor socrático / Feynman | Modo del tutor existente: "explícamelo tú a mí" | Reusa tutor | P2 |

**Tablas nuevas:** `lesson_content_cache`, `study_cards` (canónicas por cacheKey), `review_states` (FSRS por usuario, índice (user_id, due)), `review_logs` (ledger), `review_sessions` (unique user+date → idempotencia XP/racha), `concept_mastery` (materialización), `study_artifacts` (estado del kit).

**Gancho a correos (Fase 2):** "tienes N tarjetas por repasar" = el trigger de email **pedagógicamente honesto** (se dispara con olvido inminente, no por cron arbitrario).

**Costo:** ~**USD 1.6 por esqueleto NUEVO** (tarjetas+diagramas+kit); **$0 marginal** por usuario en tema repetido. La cache de contenido AHORRA más de lo que el sistema cuesta.

---

## 📦 Plan B — Kit de Estudio descargable

| Artefacto | Qué es | Prioridad |
|---|---|---|
| **Cheat sheet PDF por módulo** (1-2 págs) | keyTakeaways consolidados + glosario + mini-diagrama, Sage & Cream | **P0** |
| **Mapa visual de la ruta** (poster) | El currículo como camino visual — wow de compartir | **P0** |
| Diagrama conceptual por lección | SVG dual-coding embebido + en el cheat sheet | P1 |
| **Workbook de ruta** (15-30 págs) | Portada + mapa + cheat sheets + ejercicios (campo `practice`) + espacios de auto-explicación | P1 |
| **Certificado personalizado** | A4 apaisado, nombre + ruta + fecha + ID verificación. Por usuario, sin tokens | P1 |
| Hero PNG correos + share cards OG | <100KB, satori/og — "Completaste el Módulo 3", badges de logros | P1 |
| Ilustración temática IA (sin texto) | 1-3 por esqueleto, Imagen 4 Fast $0.02, prompt de marca fijo, fallback gradiente | P2 |
| Resumen personalizado de avance | % real + XP + racha + dominio | P2 |

**Entrega:** card "Kit de estudio" en la página de ruta (estados preparándose→listo vía el Realtime existente de learning_paths) + descarga por módulo + **LINK en los correos de hito** (no adjuntos pesados). **Gateado a Pro/compra** (palanca de conversión; `getEntitlement` ya existe).

**Costos a escala (con cache):** 10 rutas/día ≈ **$83/mes** · 100/día ≈ **$414/mes** · 1000/día ≈ escala sublineal con hit-rate 90%. Sin cache sería $13.800/mes a 1000/día — la amortización es la diferencia entre feature caro y escalable.

---

## 🗺️ Orden de construcción recomendado (integrado con correos)

1. **Correos Fase 2** (Resend ya conectado; hitos ya emitidos) — cierra el loop que el fundador confirmó. ~2 sem.
2. **Estudio Fase 1 (P0):** lesson_content_cache + flashcards + FSRS + Repaso de Hoy. ~1.5-2 sem. Riesgo bajo (Postgres + TS puro + 1 prompt Haiku).
3. **Kit Fase 1 (P0):** Storage + plantillas + task generate-artifacts + card "Kit de estudio" + link en correos. ~1 sem (3-5 días según plan).
4. **Capa de dominio (P1):** interleaving + mastery + anillos. ~1-1.5 sem.
5. **Capa visual + premium (P1/P2):** diagramas, workbook, certificado, ilustración IA. ~2-3 sem.

## ⚠️ Guardrails clave
- Regla de oro: lo caro UNA vez por esqueleto; el estado por usuario.
- Sesión tipo = lección ~15 min + repaso ~5 min; Repaso de Hoy capeado a 15 tarjetas (priorizadas por menor estabilidad al volver de pausa — no abrumar).
- Idempotencia en todo (uniques en review_sessions, xp_events, study_artifacts).
- Nada del sistema de estudio bloquea el pipeline de contenido (navegable al 25% intocable).
- Tarjetas: fuente controlada (contenido existente), máx 8-12/lección, Zod.
- Coherence principle (Mayer): solo diagramas coherentes con el texto; nada decorativo que distraiga.
- PDFs: texto seleccionable, tipografías propias, español perfecto — programático, nunca píxeles.

## ❓ Decisiones abiertas (para el fundador)
1. **Gating:** ¿Repaso de Hoy gratis (maximiza retención/racha) y kit PDF como palanca Pro? (recomendado) ¿o capear también el repaso?
2. **Backfill:** ¿generar mazos para rutas existentes ya (Batch API ~$0.11/esqueleto)?
3. ¿Dominio cuenta solo flashcards o también aciertos de quiz?
4. Versionado de mazos cuando el esqueleto suba de versión.
5. Parámetros FSRS: defaults globales al inicio, re-optimizar por usuario con datos.
