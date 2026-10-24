import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export { schema };

/** Both drivers share Drizzle's query builder; everything is typed against node-postgres. */
export type Db = NodePgDatabase<typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");
// Migration bookkeeping sits next to the tables, separate from any other app's drizzle history.
const MIGRATE = { migrationsFolder: MIGRATIONS, migrationsSchema: "freshroots", migrationsTable: "__migrations" };

export const databaseMode = (): "postgres" | "local" => (process.env.DATABASE_URL ? "postgres" : "local");

type Holder = { db?: Db; ready?: Promise<void>; close?: () => Promise<void> };
// One connection per process, surviving Next.js dev hot reloads.
const g = globalThis as unknown as { __freshrootsDb?: Holder };
const holder: Holder = (g.__freshrootsDb ??= {});

function open(): Holder {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, max: 5 });
    return { db: drizzlePg(pool, { schema }), ready: migrateWithLock(pool), close: () => pool.end() };
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Add the Neon connection string in Vercel → Settings → Environment Variables, then redeploy.");
  }
  // No database configured: embedded Postgres (PGlite) in ./.data/pglite. PGLITE_DIR=memory:// for tests.
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  return {
    db: db as unknown as Db,
    ready: migratePglite(db, MIGRATE),
    close: () => client.close(),
  };
}

/**
 * Serverless instances can start together; an advisory lock makes them migrate one at a time. The lock needs
 * a single real connection, so Neon's direct URL is used when the Vercel integration provides it.
 */
async function migrateWithLock(pool: Pool) {
  const directUrl = process.env.DATABASE_URL_UNPOOLED;
  const direct = directUrl ? new Pool({ connectionString: directUrl, max: 1 }) : pool;
  const client = await direct.connect();
  try {
    await client.query("select pg_advisory_lock(4417001)");
    await migratePg(drizzlePg(client, { schema }), MIGRATE);
  } finally {
    await client.query("select pg_advisory_unlock(4417001)").catch(() => undefined);
    client.release();
    if (direct !== pool) await direct.end();
  }
}

/** The database, with pending migrations applied on first use. */
export async function getDb(): Promise<Db> {
  if (!holder.db) Object.assign(holder, open());
  try {
    await holder.ready;
  } catch (err) {
    // Let the next request retry instead of caching a failed connection forever.
    const close = holder.close;
    holder.db = holder.ready = holder.close = undefined;
    await close?.().catch(() => undefined);
    throw err;
  }
  return holder.db!;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = holder.ready = holder.close = undefined;
}
