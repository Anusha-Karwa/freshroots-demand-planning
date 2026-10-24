import { and, desc, eq, lte, max, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays } from "@/lib/dates";
import { ALL_DISTRIBUTORS } from "@/lib/data/clean";
import type { SkuInput } from "@/lib/rules/engine";

export interface SkuInfo {
  id: string; name: string; category: string | null; perishable: boolean; standardOrderQty: number; unit: string;
  supplierId: string | null; unitCost: number | null; unitPrice: number | null; priceSource: string; zohoItemId: string | null;
}

export interface EngineData {
  skus: Map<string, SkuInfo>;
  inputs: SkuInput[];
  lastWeek: string | null; // Monday of the latest week used
  stockAsOf: string | null;
  hasDistributorDetail: boolean;
}

/**
 * Turns the database into one SkuInput per active SKU. Each SKU's series runs from its first week with sales to
 * the latest week; weeks with no row count as zero. throughWeek (a Monday) limits the history, for backtests.
 */
export async function loadEngineData(db: Db, opts: { throughWeek?: string } = {}): Promise<EngineData> {
  const skuRows = await db.select().from(schema.skus).where(eq(schema.skus.active, true));
  const skus = new Map<string, SkuInfo>(skuRows.map((s) => [s.id, s]));

  const weekFilter = opts.throughWeek ? lte(schema.weeklySales.weekStart, opts.throughWeek) : undefined;
  const totals = await db
    .select({ week: schema.weeklySales.weekStart, sku: schema.weeklySales.skuId, units: sql<number>`sum(${schema.weeklySales.units})`.mapWith(Number) })
    .from(schema.weeklySales)
    .where(weekFilter)
    .groupBy(schema.weeklySales.weekStart, schema.weeklySales.skuId);

  const lastWeek = totals.reduce<string | null>((m, r) => (!m || r.week > m ? r.week : m), null);
  if (!lastWeek) return { skus, inputs: [], lastWeek: null, stockAsOf: null, hasDistributorDetail: false };
  const prevWeek = addDays(lastWeek, -7);

  const bySku = new Map<string, Map<string, number>>();
  for (const r of totals) (bySku.get(r.sku) ?? bySku.set(r.sku, new Map()).get(r.sku)!).set(r.week, r.units);

  // Distributor detail for the last two weeks (rule 6b). Absent when sales are SKU-level only.
  const detail = await db.select().from(schema.weeklySales).where(and(
    ne(schema.weeklySales.distributorId, ALL_DISTRIBUTORS),
    sql`${schema.weeklySales.weekStart} in (${lastWeek}, ${prevWeek})`,
  ));
  const dist = new Map<string, { last: Record<string, number>; prev: Record<string, number> }>();
  for (const r of detail) {
    const d = dist.get(r.skuId) ?? dist.set(r.skuId, { last: {}, prev: {} }).get(r.skuId)!;
    const side = r.weekStart === lastWeek ? d.last : d.prev;
    side[r.distributorId] = (side[r.distributorId] ?? 0) + r.units;
  }

  const { stock, asOf } = await latestStock(db, opts.throughWeek ? addDays(opts.throughWeek, 7) : undefined);

  const inputs: SkuInput[] = [];
  for (const sku of skus.values()) {
    const weeks = bySku.get(sku.id);
    const weekly: number[] = [];
    if (weeks?.size) {
      const first = [...weeks.keys()].sort()[0];
      for (let w = first; w <= lastWeek; w = addDays(w, 7)) weekly.push(weeks.get(w) ?? 0);
    }
    const d = dist.get(sku.id);
    inputs.push({
      skuId: sku.id,
      perishable: sku.perishable,
      standardOrderQty: sku.standardOrderQty,
      weekly,
      stock: stock.get(sku.id) ?? null,
      ...(d && Object.keys(d.last).length && Object.keys(d.prev).length ? { lastWeekByDistributor: d.last, prevWeekByDistributor: d.prev } : {}),
    });
  }
  return { skus, inputs, lastWeek, stockAsOf: asOf, hasDistributorDetail: detail.length > 0 };
}

/** Latest stock per SKU (summed across locations), optionally on or before a date. */
export async function latestStock(db: Db, onOrBefore?: string) {
  const rows = await db.select().from(schema.stockSnapshots)
    .where(onOrBefore ? lte(schema.stockSnapshots.asOf, onOrBefore) : undefined)
    .orderBy(desc(schema.stockSnapshots.asOf));
  const latestDate = new Map<string, string>();
  const stock = new Map<string, number>();
  for (const r of rows) {
    const d = latestDate.get(r.skuId);
    if (d && d !== r.asOf) continue; // an older snapshot
    latestDate.set(r.skuId, r.asOf);
    stock.set(r.skuId, (stock.get(r.skuId) ?? 0) + r.units);
  }
  const asOf = [...latestDate.values()].sort().pop() ?? null;
  return { stock, asOf };
}

export async function latestSalesWeek(db: Db) {
  const [row] = await db.select({ last: max(schema.weeklySales.weekStart) }).from(schema.weeklySales);
  return row?.last ?? null;
}
