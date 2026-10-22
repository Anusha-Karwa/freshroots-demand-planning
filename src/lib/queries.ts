import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Metrics } from "@/lib/rules/engine";

export async function latestRun() {
  const db = await getDb();
  const [run] = await db
    .select()
    .from(schema.forecastRuns)
    .where(eq(schema.forecastRuns.status, "done"))
    .orderBy(desc(schema.forecastRuns.id))
    .limit(1);
  return run ?? null;
}

export async function recentRuns(limit = 8) {
  const db = await getDb();
  return db.select().from(schema.forecastRuns).orderBy(desc(schema.forecastRuns.id)).limit(limit);
}

export async function recommendationsForRun(runId: number) {
  const db = await getDb();
  const rows = await db
    .select({ rec: schema.recommendations, sku: schema.skus })
    .from(schema.recommendations)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .where(eq(schema.recommendations.runId, runId))
    .orderBy(
      sql`case ${schema.recommendations.primaryFlag} when 'STOCKOUT_RISK' then 0 when 'HIGH_DEMAND' then 1 else 2 end`,
      schema.recommendations.skuId,
    );
  return rows.map((r) => ({ ...r.rec, metrics: r.rec.metrics as Metrics, sku: r.sku }));
}

export async function exceptionsForRun(runId: number) {
  const db = await getDb();
  const rows = await db
    .select({ ex: schema.exceptions, sku: schema.skus })
    .from(schema.exceptions)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.exceptions.skuId))
    .where(eq(schema.exceptions.runId, runId))
    .orderBy(schema.exceptions.skuId);
  return rows.map((r) => ({ ...r.ex, metrics: r.ex.metrics as Metrics & { ruleFlags: string[] }, sku: r.sku }));
}
