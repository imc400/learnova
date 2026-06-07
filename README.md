# Learnova

**Plataforma de rutas de aprendizaje a medida con IA.** Le dices tu meta y genera una ruta modular completa: lecciones paso a paso, pruebas reales, un tutor de IA en vivo y el mejor video gratuito de YouTube curado para cada paso.

> De querer aprenderlo a saberlo.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend + Backend | Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind 4 · Shadcn/UI |
| Base de datos | Supabase (Postgres) + Drizzle ORM + pgvector |
| Auth | Supabase Auth (email + Google) con RLS |
| IA | Anthropic por niveles — **Opus 4.8** planifica · **Sonnet 4.6** genera · **Haiku 4.5** rankea |
| Streaming tutor | Vercel AI SDK 6 (SSE) |
| Jobs | Trigger.dev (generación de larga duración) |
| Video | YouTube Data API v3 + IFrame Player (embedding oficial) |
| Pagos | Flow.cl (Chile) — Stripe en fase 2 |

Decisiones y arquitectura completas en [`DECISIONES-TECNICAS.md`](./DECISIONES-TECNICAS.md).

## Requisitos

- **Node.js 22+** y **pnpm 9+** (`npm i -g pnpm`)
- Cuentas: Supabase, Anthropic, Google Cloud (YouTube). Opcionales: Trigger.dev, Flow.cl.

## Setup paso a paso

```bash
# 1. Instalar dependencias
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env
#    → completa los valores (ver comentarios en .env.example)
```

**3. Base de datos (Supabase):**
```bash
pnpm db:push          # crea las tablas en tu Postgres de Supabase
```
Luego, en el **SQL Editor de Supabase**, ejecuta el contenido de
[`supabase/policies.sql`](./supabase/policies.sql) (crea el trigger de perfil y
las políticas RLS).

**4. Auth con Google (opcional):** en Supabase → Authentication → Providers →
Google, pega tu Client ID/Secret y agrega `…/auth/callback` como redirect.

**5. Levantar la app:**
```bash
pnpm dev              # http://localhost:3000
```

En dev, la generación de rutas corre **inline** (sin necesidad de Trigger.dev).

### Producción: Trigger.dev (recomendado)
La generación de una ruta tarda 3–8 min — supera el límite de serverless. Para producción:
```bash
# Configura TRIGGER_SECRET_KEY y TRIGGER_PROJECT_REF en .env
pnpm trigger:dev      # corre los workers localmente
# deploy: npx trigger.dev@latest deploy
```

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta la app en desarrollo |
| `pnpm build` / `pnpm start` | Build y arranque de producción |
| `pnpm typecheck` | Chequeo de tipos |
| `pnpm db:push` | Aplica el esquema a la DB |
| `pnpm db:generate` / `pnpm db:migrate` | Migraciones versionadas |
| `pnpm db:studio` | Explorador visual de la DB |
| `pnpm trigger:dev` | Workers de Trigger.dev en local |

## Estructura

```
src/
  app/                # Rutas (App Router)
    (auth)/           # login, signup
    app/              # área autenticada (/app): dashboard, crear, rutas, lecciones
    api/tutor/        # streaming del tutor (SSE)
    auth/             # callback y signout
  components/         # UI (ui/), marketing/, app/, auth/, brand/
  db/                 # esquema y cliente Drizzle
  lib/
    ai/               # capa de IA: modelos, prompts, esquemas, generación
    youtube/          # búsqueda + curación de videos
    generation/       # orquestador del pipeline
    supabase/         # clientes browser/server/middleware
  server/
    actions/          # Server Actions (crear ruta, corregir quiz, pagos)
    queries/          # consultas de lectura
  trigger/            # tareas de Trigger.dev
supabase/policies.sql # RLS + trigger de perfil
```

## ✅ Lo único que falta para que funcione: tus accesos

El código está **completo y listo**. Solo necesitas conectar:

- [ ] **Supabase** → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` + correr `db:push` y `policies.sql`
- [ ] **Anthropic** → `ANTHROPIC_API_KEY`
- [ ] **YouTube Data API** → `YOUTUBE_API_KEY`
- [ ] (Producción) **Trigger.dev** → `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF`
- [ ] (Monetización) **Flow.cl** → `FLOW_API_KEY`, `FLOW_SECRET_KEY` + facturación electrónica SII
