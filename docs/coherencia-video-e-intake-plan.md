# Aulia — Coherencia Lección↔Video↔Quiz + Intake Adaptativo + Pricing USD 9

> Investigación + diseño multi-agente (5 agentes, con fuentes y auditoría del código).
> Reporte completo: workflow `wf_b912b037-c0c`. Complementa los planes de engagement/correos y estudio/descargables.

---

## 🎯 Veredicto estratégico

### 1. La coherencia con el video ES posible y 100% ToS-safe — vía Gemini
**Gemini 2.5 Flash acepta URLs de YouTube como input** (Google procesando su propio contenido — la ÚNICA vía legal). Aulia nunca toca YouTube fuera de la Data API oficial; cero scraping (la auditoría enviada queda intacta).
- Costo: **~USD 0.02/video** (10 min, media_resolution=low; Flash-Lite ~0.007; la feature YouTube-URL hoy está "at no charge" en preview — presupuestado conservador).
- PROHIBIDO para siempre: librerías de transcripts (youtube-transcript-api, Supadata, Apify) = scraping = riesgo directo a la cuota auditada.
- El digest guarda outline/conceptos/anclas — NUNCA transcripción verbatim.

### 2. El intake adaptativo NO rompe la caché — la MEJORA
El wizard normaliza el tema (`normalizedTopic`) → **sube el hit-rate** que hoy el texto libre fragmenta. Lo personal vive en un **overlay por ruta** (~USD 0.01-0.05) que adapta título, encuadres, logros y merge-fields de correos. **Nada personal entra a la cacheKey ni al contenido compartido.**

### 3. La economía a USD 9/ruta es EXCELENTE
| Escenario | Costo/ruta | Margen |
|---|---|---|
| **Warm** (cache hit — el caso mayoritario a escala) | ~USD 0.45-0.47 (¡el mayor costo es el fee de Flow!) | **~95%** |
| **Cold** (primer usuario de un tema-nivel-idioma) | ~USD 2.6-3.4 (se paga UNA vez por canónico) | 62-71% |
| **Preview sin pagar** (esqueleto+overlay, generación completa solo post-pago) | ~USD 0.06 warm | no quema dinero en quien no convierte |

**Márgenes blended:** 10 rutas/día → ~76% (~USD 70/día) · 100/día → ~89% (~USD 800/día) · **1.000/día → ~93% (~USD 8.350/día)**.
Condiciones a escala: Gemini paid tier desde el día 1 + el uplift de cuota YouTube (la auditoría enviada es el prerequisito).

---

## 📐 Plan A — Pipeline de coherencia (independiente del intake; puede ir primero)

Reorden del pipeline por módulo: **video-first**.
1. **Queries desde los stubs** (1 llamada Haiku batch por módulo, ~USD 0.01/ruta) — ya no desde la lección.
2. Curación actual intacta (search cache + videos.list + ranker).
3. **Digest del video top-1 con Gemini** (outline con timestamps, conceptos, ejemplos con minuto, terminología del creador, 6-10 quizAnchors, coverage 0-1) → tabla **`video_insights` cacheada por videoId SIN TTL** (es output de Gemini, no metadato de la Data API), compartida entre todos los usuarios.
4. **Lección generada EN UNA llamada ya anclada al digest** (no re-pasada — costaría doble): terminología del creador, secciones compatibles con el orden del video, y bloque nuevo `videoGuide` ("En el video verás…" con minutos → deep-links con `start` del IFrame oficial, compatible con la auditoría).
5. **Quiz DESPUÉS de la lección** (sale del Promise.all ciego), grounded: cada pregunta declara `source: video|lesson|both` + timestamp **post-validado en código** (±60s de un anchor real; si no valida → degrada a 'lesson'). Si el digest vino del fallback: CERO timestamps inventados.
6. **Coverage gate**: si coverage < 0.5 → se digiere el candidato #2 y gana el mejor (cap 2 digests/lección). El ranking por metadatos pasa a selección verificada por contenido real.
7. **Fallback automático** (provider pattern): "metadata brief" con title + description completa + chapters parseados de videos.list (que ya se paga) — en memoria, nunca persistir description cruda.

**Costo incremental:** ~USD 0.55-0.85 por ruta 100% fría → centavos con cachés. La navegabilidad al 25% no se toca.

## 📐 Plan B — Intake adaptativo + USD 9

1. **Wizard una-pregunta-a-la-vez** (reemplaza /app/crear): pregunta inicial "¿qué quieres lograr?" → Haiku clasifica dominio + genera **3-5 preguntas** contra un **catálogo CERRADO de componentes Zod** (number+unidad, select, multiselect, text corto — nunca preguntas raras), cada una con su "por qué pregunto esto".
2. **Gate YMYL** (salud/finanzas/legal): disclaimers (educativo, no consejo médico), datos sensibles solo en **RANGOS** (edad por década, objetivo por categoría — nunca peso/estatura exactos), y dominios a rechazar.
3. **normalizedTopic + cacheKey v2** — la pieza que paga todo: "quiero aprender ia" / "inteligencia artificial desde cero" → mismo canónico.
4. **Overlay de personalización post-cache** (jsonb por ruta, 1 llamada Haiku): título personalizado, encuadre de módulos hacia SU meta, ejemplos del wizard, merge-fields para correos ("vas a mitad de camino hacia bajar esos 5kg de forma sana"), logros por ruta.
5. **Preview de la ruta ANTES de pagar** (esqueleto + overlay, ~USD 0.06 warm) → **paywall USD 9** (8.990 CLP vía Flow) → generación completa post-pago. Pro 15/mes queda como "rutas ilimitadas + kit de estudio".

## 🗺️ Fases
| Fase | Qué | Esfuerzo |
|---|---|---|
| **0 — Spikes** | Validar Gemini-URL en 5 videos reales (costo/calidad/latencia) + prototipo del wizard | 2-3 días |
| **1 — Coherencia** | video_insights + reorden pipeline + lección anclada + quiz grounded + coverage gate | 1-1.5 sem |
| **2 — Intake + USD 9** | wizard + YMYL + normalizedTopic/cacheKey v2 + overlay + preview/paywall | 2-3 sem |
| **3 — Personalización transversal** | correos con la meta + logros por ruta + lesson_content_cache (tarea #29) | 1.5-2 sem |
| **4 — Hardening a escala** | telemetría drop-off, recalibración de nivel, cobro robusto | 1-2 sem |

## ⚠️ Guardrails no negociables
- Prohibición absoluta y documentada de transcripts de terceros (scraping) — protege la cuota auditada.
- Digest = outline/anclas, nunca verbatim.
- Videos NUNCA buscados/personalizados por usuario (queries canónicas → protege cuota).
- Datos personales sensibles solo en rangos; nada personal en cacheKey ni prompts cacheados.
- Reproductor IFrame sin modificar (deep-links solo con `start`, sancionado).
