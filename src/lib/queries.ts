import { and, asc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { latestRun } from "@/lib/forecast/run";

/** The latest run's items in one queue, with their SKU. */
export async function queueItems(db: Db, queue: "review" | "exception") {
  const run = await latestRun(db);
  if (!run) return { run: null, items: [] };
  const rows = await db.select({ item: schema.runItems, sku: schema.skus })
    .from(schema.runItems)
    .innerJoin(schema.skus, eq(schema.skus.id, schema.runItems.skuId))
    .where(and(eq(schema.runItems.runId, run.id), eq(schema.runItems.queue, queue)))
    .orderBy(asc(schema.runItems.skuId));
  return { run, items: rows };
}

export type QueueRow = Awaited<ReturnType<typeof queueItems>>["items"][number];
