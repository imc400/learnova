# Learnova — Decisiones Técnicas (v1)

> Fecha: 2026-06-06 · Basado en investigación multi-agente (6 agentes, 152 búsquedas web, fuentes verificadas).
> Producto: plataforma B2C de **rutas de aprendizaje a medida** con IA (no un generador de cursos): ruta modular + tutor de IA en vivo + pruebas reales + video gratuito de YouTube curado por paso. Español primero. Mercado LatAm/Chile.

---

## 0. TL;DR

El stack es **un monolito Next.js + Supabase + Anthropic**, pensado para que un equipo chico lo construya y mantenga con calidad production-grade. La IA va **por niveles** (Opus planifica → Sonnet genera → Haiku rankea) con **prompt caching + Batch API** como base de la "caché de cabeza gruesa". YouTube se usa **solo con el IFrame oficial y metadatos oficiales** (nada de scraping). **Los márgenes son altísimos** (>90% en suscripción): el costo de IA es <1% del ingreso a escala. El riesgo real de tu P&L no es la IA — es la adquisición (tu fuerte) y las comisiones de pago.

---

## 1. Stack elegido

| Capa | Decisión | Por qué | Costo |
|---|---|---|---|
| **Frontend + Backend** | Next.js 16 (App Router, Server Actions) + TypeScript + Tailwind 4 + Shadcn/UI | Un repo, un lenguaje full-stack; SSR para SEO; streaming nativo para el tutor | $0 (open source) |
| **API interna** | tRPC (90% de la superficie) + REST solo para webhooks. ORM: **Drizzle** | Type-safety end-to-end; Drizzle = bundle 10x menor y cold-starts 3x más rápidos que Prisma | $0 |
| **Datos + Auth + Realtime** | **Supabase Pro** (Postgres + Auth + RLS + Realtime + pgvector) | Colapsa 3 proveedores en 1 factura. Auth 10x más barato que Clerk a escala | $25/mes |
| **Base vectorial** | **pgvector** dentro de Supabase (día 1). Migrar a Qdrant solo >10M vectores | Gratis encima de Postgres; aguanta 5–10M vectores. No agregar infra que no necesitas aún | $0 extra |
| **Embeddings** | **Voyage AI `voyage-4-lite`** | $0.02/M tokens **+ 200M tokens gratis** (cubre todo alpha/beta); mejor español que OpenAI small; alineado con Anthropic | ~$0 al inicio |
| **Jobs / generación IA** | **Trigger.dev** | Único sin límite de tiempo: una ruta tarda 3–8 min (imposible en serverless de 60–300s). Da streaming de progreso | $0 → $10/mes |
| **Orquestación LLM** | **Vercel AI SDK 6** (UI streaming) + **Anthropic SDK directo** en los jobs. **NO LangChain** | LangChain es incompatible con Edge, pesado y oculta bugs. AI SDK = cambiar de modelo es cambiar un string | $0 |
| **Tiempo real (tutor)** | **SSE** vía Vercel AI SDK (`useChat`), **no WebSockets** | El chat es unidireccional (servidor→cliente). SSE funciona sobre HTTP estándar sin config | $0 |
| **Pagos** | **Flow.cl** desde el día 1 (Chile). Stripe en fase 2 (internacional) | Cobrar en USD vía Stripe-US **baja la aceptación de tarjetas chilenas a ~60%** = fatal para freemium. Flow: Webpay + suscripciones nativas | 2.89% + IVA (~3.44%) |
| **Hosting** | **Vercel** (app Next.js) + **Railway** (workers). Railway-only para abaratar al inicio | Vercel = Edge CDN con presencia LatAm + preview deploys. Railway = workers persistentes sin cold-start | ~$20–40/mes |

**Costo fijo de infraestructura al lanzar: ~$55–65/mes** (Vercel $20 + Supabase $25 + Trigger.dev $0–10 + dominio/email ~$10), antes del costo variable de IA.

---

## 2. IA por niveles + caché + batch (todo Anthropic, un solo proveedor)

| Nivel | Tarea | Modelo | Precio (in/out por 1M) |
|---|---|---|---|
| **1 — Planificar** | Esqueleto de la ruta (grafo de módulos en JSON, `structured outputs`) | **Opus 4.8** + effort alto | $5 / $25 |
| **2 — Generar** | Lecciones, notas, quizzes (el 80% del costo) | **Sonnet 4.6** | $3 / $15 |
| **3 — Rankear/clasificar/corregir** | Elegir el video ideal de YouTube, etiquetar nivel/idioma, corregir respuestas | **Haiku 4.5** | $1 / $5 |
| **Tutor en vivo** | Chat (system prompt + historial cacheados) | **Sonnet 4.6** | $3 / $15 |

**Los dos mecanismos de costo (implementar en el Sprint 1, no después):**
- **Prompt caching** → lecturas a ~0.1x (hasta 90% de ahorro). Se cachea el system prompt pedagógico + el esqueleto del tema popular. Prefijo mínimo: 4.096 tokens (Opus/Haiku), 2.048 (Sonnet). **Esto ES la "caché de cabeza gruesa".**
- **Batch API** → –50%. Pre-generar de noche los esqueletos y lecciones de los ~500 temas más buscados en LatAm.

> Optimización futura opcional: si el ranking de YouTube supera ~50M tokens/mes, agregar **Gemini 2.5 Flash-Lite** ($0.10/$0.40) solo para esa tarea (2.5x más barato que Haiku). No vale la complejidad por debajo de ese umbral.

---

## 3. YouTube — legal, barato, anti link-rot

**Flujo en 3 fases:**
1. **Generación de ruta (1 vez por tema/idioma/nivel):** `search.list` → `videos.list` (metadatos de 15 candidatos) → **Haiku** rankea y elige el mejor + **2 alternativas de respaldo** → se guardan en Supabase.
2. **Visualización (cada acceso):** solo un **IFrame oficial** de YouTube → **cero consumo de cuota, cero infra de video** (YouTube pone CDN, calidad adaptativa y subtítulos). El evento `onError` del Player API dispara la alternativa guardada.
3. **Mantenimiento (job nocturno):** `videos.list` en lote (50 IDs/llamada) detecta videos caídos y activa respaldos.

**Líneas rojas legales (no negociables):**
- ✅ **IFrame oficial** = único método de embedding permitido. Gratis.
- ❌ **NO** usar `youtube-transcript-api` ni scraping de transcripciones en producción → viola Developer Policies III.E.6; riesgo de **suspensión de la cuenta Google Cloud** + daños de hasta **$150.000 USD**. Rankeamos solo con **metadatos oficiales** (título + descripción + tags), que bastan.
- ❌ **NO** descargar/re-hostear video ni bloquear los ads del player.

**⚠️ Cuello de botella real (corregido en la síntesis):** `search.list` cuesta **100 unidades** y consume el presupuesto general de **10.000 unidades/día** → techo ~**100 búsquedas/día**. Mitigación: 1 búsqueda amplia por ruta (no por paso) + caché de cabeza gruesa (80% de rutas no buscan nada nuevo) + **pedir ampliación de cuota a Google temprano** (gratis, pero la auditoría tarda semanas; exige cumplir los requisitos del IFrame primero). Costo monetario de la API de YouTube: **$0**.

---

## 4. Modelo de costos y márgenes

**Costo por ruta generada (10 lecciones + 10 quizzes + 30 videos rankeados):**
- Sin caché (tema nuevo): **~$0.36**
- Con caché + batch (tema popular): **~$0.17** (≈53% de ahorro)

**Costo del tutor de IA por usuario activo/mes:** $0.025–$0.072.

**Márgenes (lo decisivo para tu pregunta "¿la gente paga y cierra?"):**
- **Suscripción $15/mes:** COGS por suscriptor ≈ $1–2 (IA ~$0.20–0.25 + Flow ~$0.52 + prorrateo de infra). **Margen bruto >90%.**
- **Ruta única $19 one-time:** COGS ≈ $0.85–1.05. **Margen bruto >94%.** Es el producto de mayor margen y el mejor gancho de adquisición.

**Proyección por etapa (IA + infra, sin marketing):**
| Etapa | Total/mes | % del ingreso |
|---|---|---|
| Pre-lanzamiento | ~$55 fijos | — |
| $1K MRR (~65 subs) | ~$113 | ~11% |
| $5K MRR (~330 subs) | ~$400–500 | ~10% |
| 10.000 usuarios activos | ~$1.060–1.110 en IA | **<1%** del ingreso |

**Conclusión:** con caché+batch desde el Sprint 1, la IA **nunca** es el riesgo de márgenes. Lo que pesa en el P&L es el **CAC/marketing** (tu fortaleza) y las **comisiones de pago**.

---

## 5. Secuencia de construcción

- **Fase 0 — Fundaciones (sem. 1–2):** monorepo Next.js 16 + TS + Tailwind + Shadcn. Supabase Pro (Postgres + Auth + RLS). Esquema: usuarios, rutas, módulos, lecciones, quizzes, progreso, `video_candidates` (con alternativas). Drizzle + migraciones. Flow.cl en sandbox. **Capa fina de abstracción sobre el Anthropic SDK desde el primer commit.**
- **Fase 1 — Generación core (sem. 3–5):** pipeline en Trigger.dev: Opus planifica → Sonnet genera → Haiku rankea videos. **Prompt caching desde el día 1.** Streaming de progreso. Prueba el product-market fit con generación pura — **sin RAG todavía.**
- **Fase 2 — Tutor + experiencia (sem. 6–8):** chat con Sonnet vía AI SDK (SSE). IFrame con `onError` → fallback. Render de lecciones/quizzes con corrección automática (Haiku). Realtime de progreso/streaks.
- **Fase 3 — Monetización + cabeza gruesa (sem. 9–11):** Flow.cl en producción (freemium → $15/mes + ruta $19). **Facturación electrónica SII** (Bsale/Defontana/DTE) — bloqueante legal en Chile. Batch nocturno para pre-generar los ~500 temas top. **Pedir ampliación de cuota de YouTube.**
- **Fase 4 — Beta + calidad (sem. 12–14):** cohorte chilena. **Evaluación humana de las primeras ~500 rutas** antes de escalar marketing. Telemetría de costo, cache hit rate, link-rot.
- **Fase 5 — Multimodal (mes 4–5):** TTS de narración con **Voxtral** (mejor español, $0.016/1K chars, pre-generado en batch). Imágenes: **Ideogram** (infografías con texto) + **Flux/fal.ai** (decorativas) + **Recraft V4.1** (iconografía SVG). Tutor por voz con **Cartesia** si hay demanda.
- **Fase 6 — RAG + escala (mes 5–6+):** RAG sobre pgvector con corpus **curado y pequeño** (Wikipedia ES + textos académicos por tema, <500K vectores) — nunca un corpus web genérico. Semantic caching. Stripe (vía Atlas) para internacional.

---

## 6. Riesgos principales

| Riesgo | Nivel | Mitigación |
|---|---|---|
| **Cuota de YouTube** (`search.list` agota 10k unidades/día) | ALTO | 1 búsqueda/ruta + caché + pedir ampliación temprano con IFrame compliant |
| **Scraping de transcripciones** (legal) | ALTO | NO usarlo; rankear solo con metadatos oficiales. Documentar para que ningún dev lo reintroduzca |
| **Pagos en Chile** (Stripe-US baja aceptación a 60%) | ALTO | Flow.cl día 1. + integrar facturación SII antes del lanzamiento |
| **Costo LLM sin caché** | MODERADO (auto-infligido) | Caché de cabeza gruesa + Batch en el Sprint 1, no como optimización tardía |
| **Calidad en español de LatAm/Chile** | MODERADO | Evaluación humana de las primeras ~500 rutas; penalizar viewCount viral en el ranking |
| **Link-rot / dependencia de YouTube** | MODERADO | 2–3 alternativas por paso + verificación batch diaria + reemplazo bajo demanda |

---

## 7. Decisiones abiertas del fundador

1. **Catálogo de "cabeza gruesa":** ¿cuáles son los 300–500 temas LatAm a pre-generar? (decisión de negocio/marketing; determina cache hit rate y costo real de Opus).
2. **Nivel de personalización:** ¿cuánto re-llama a Opus por usuario vs. servir el esqueleto cacheado? (el trade-off central "a medida" vs. plantilla).
3. **Tutor:** ¿solo texto al lanzar, o también voz? (decide si Cartesia/Voxtral entran en fase 2).
4. **Política freemium:** ¿cuántas rutas/mensajes gratis antes del paywall? (es el único tramo con riesgo de margen).
5. **Entidad USA (Stripe Atlas, ~$500):** ¿se constituye y cuándo? (no urgente si el foco inicial es Chile).
6. **Facturación electrónica SII:** ¿Bsale, Defontana o DTE directo? (bloqueante legal para cobrar formalmente en Chile).
7. **Evaluación humana de calidad:** ¿hay presupuesto para un revisor pedagógico en español de Chile?

---

## 8. Fuentes clave
Precios Claude verificados vía referencia oficial de la API. Resto verificado en 2026 vía WebSearch/WebFetch: pricing oficial de OpenAI, Google Gemini, Voyage AI, Supabase, Qdrant, Pinecone, Weaviate, ElevenLabs, Cartesia, Mistral Voxtral, Trigger.dev, Flow.cl, Vercel/Railway; docs oficiales de YouTube Data API v3 (cuota, ToS, Developer Policies, IFrame Player API). Lista completa de URLs en el resultado del workflow `learnova-stack-research`.
