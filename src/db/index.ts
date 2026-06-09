import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/*
  Cliente de base de datos (Drizzle + postgres.js).
  - `prepare: false` es obligatorio cuando se usa el pooler de Supabase en modo
    transacción (puerto 6543). Para conexión directa (5432) también es seguro.
  - Reutilizamos una sola instancia en dev para no agotar conexiones con HMR.
*/

const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof postgres> | undefined;
};

const client =
  globalForDb.client ?? postgres(env.DATABASE_URL, { prepare: false });

if (env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
export type DB = typeof db;
