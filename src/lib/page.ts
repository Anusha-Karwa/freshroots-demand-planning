import { connection } from "next/server";
import { getDb } from "@/db";

/** Every page reads live data: opt out of build-time prerendering, then open the database. */
export async function pageDb() {
  await connection();
  return getDb();
}

/** Next.js passes searchParams as a promise of string | string[] values. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
