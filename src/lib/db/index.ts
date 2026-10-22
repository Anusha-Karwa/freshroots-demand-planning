import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export { schema };

// Both drivers expose the same query builder; type everything against node-postgres.
export type Db = NodePgDatabase<typeof schema>;

export const dbMode = (): "postgres" | "pglite" => (process.env.DATABASE_URL ? "postgres" : "pglite");

// PGLITE_DIR=memory:// gives tests a throwaway in-memory database.
const pgliteDir = () => process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type Holder = { db?: Db; ready?: Promise<void>; close?: () => Promise<void> };
// Survive Next.js dev hot reloads: one connection per process.
const g = globalThis as unknown as { __freshrootsDb?: Holder };
const holder: Holder = (g.__freshrootsDb ??= {});

function create(): Holder {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      ready: migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => pool.end(),
    };
  }
  const dir = pgliteDir();
  if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  return {
    db: db as unknown as Db,
    ready: migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}

/** Returns the database, applying pending migrations on first use. */
export async function getDb(): Promise<Db> {
  if (!holder.db) Object.assign(holder, create());
  await holder.ready;
  return holder.db!;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = holder.ready = holder.close = undefined;
}
