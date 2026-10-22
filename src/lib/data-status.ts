import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const daysBetween = (fromIso: string, to = new Date()) =>
  Math.floor((to.getTime() - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

/** What data is loaded and how old it is. "Data age" = days since the last day covered by sales data. */
export async function dataStatus() {
  const db = await getDb();
  const [counts] = (
    await db.execute<{ skus: number; distributors: number; sales_rows: number; weeks: number; first_week: string | null; last_week: string | null }>(sql`
      select (select count(*)::int from skus) as skus,
             (select count(*)::int from distributors) as distributors,
             (select count(*)::int from weekly_sales) as sales_rows,
             (select count(distinct week_start)::int from sku_weekly_sales) as weeks,
             (select min(week_start)::text from sku_weekly_sales) as first_week,
             (select max(week_start)::text from sku_weekly_sales) as last_week`)
  ).rows;
  const [lastSales] = await db
    .select()
    .from(schema.dataLoads)
    .where(eq(schema.dataLoads.fileType, "weekly_sales"))
    .orderBy(desc(schema.dataLoads.loadedAt))
    .limit(1);
  const loads = await db.select().from(schema.dataLoads).orderBy(desc(schema.dataLoads.loadedAt)).limit(10);
  const dataAsOf = lastSales?.dataAsOf ?? null;
  return { ...counts, dataAsOf, dataAgeDays: dataAsOf ? daysBetween(dataAsOf) : null, loads };
}
