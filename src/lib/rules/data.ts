import { sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { ALL_DISTRIBUTORS } from "@/lib/db/schema";
import { addDays, monthOfWeek } from "@/lib/seed/parse";
import { isPerishable, type RulesConfig } from "@/lib/config/rules";
import type { SkuInput } from "./engine";

export interface SkuInfo {
  skuId: string;
  name: string;
  category: string | null;
  isPerishable: boolean;
  standardOrderQty: number;
  unitCost: number | null;
  unitPrice: number | null;
  priceSource: string | null;
  vendorId: string | null;
}

/** Weekly SKU totals as a dense series per SKU (missing weeks inside the range filled with 0). */
export interface SalesHistory {
  weeks: string[]; // every week (Monday) from the first to the last sales week
  bySku: Map<string, (number | null)[]>; // aligned to `weeks`; null = before the SKU's first sale
  hasDistributorDetail: boolean;
}

/** Active SKUs. With `config`, perishability includes Raghav's overrides from the rules config. */
export async function loadSkus(db: Db, config?: RulesConfig): Promise<SkuInfo[]> {
  const rows = await db.select().from(schema.skus).where(sql`${schema.skus.active}`).orderBy(schema.skus.skuId);
  return rows.map((r) => ({
    skuId: r.skuId, name: r.name, category: r.category,
    isPerishable: config ? isPerishable(config, r.skuId, r.isPerishable) : r.isPerishable,
    standardOrderQty: r.standardOrderQty, unitCost: r.unitCost, unitPrice: r.unitPrice,
    priceSource: r.priceSource, vendorId: r.vendorId,
  }));
}

export async function loadHistory(db: Db): Promise<SalesHistory> {
  const rows = await db
    .select({ w: schema.skuWeeklySales.weekStart, sku: schema.skuWeeklySales.skuId, u: schema.skuWeeklySales.units })
    .from(schema.skuWeeklySales)
    .orderBy(schema.skuWeeklySales.weekStart);
  const weeks: string[] = [];
  if (rows.length) for (let w = rows[0].w; w <= rows[rows.length - 1].w; w = addDays(w, 7)) weeks.push(w);
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const bySku = new Map<string, (number | null)[]>();
  const first = new Map<string, number>();
  for (const r of rows) {
    if (!bySku.has(r.sku)) bySku.set(r.sku, Array(weeks.length).fill(null));
    const i = idx.get(r.w)!;
    bySku.get(r.sku)![i] = r.u;
    first.set(r.sku, Math.min(first.get(r.sku) ?? i, i));
  }
  for (const [sku, series] of bySku) for (let i = first.get(sku)!; i < series.length; i++) series[i] ??= 0;
  const [d] = (
    await db.execute<{ n: number }>(sql`select count(*)::int as n from weekly_sales where distributor_id <> ${ALL_DISTRIBUTORS} limit 1`)
  ).rows;
  return { weeks, bySku, hasDistributorDetail: d.n > 0 };
}

/** Stock per SKU from the latest snapshot on or before `onOrBefore` (summed across locations). */
export async function loadStock(db: Db, onOrBefore?: string): Promise<{ date: string | null; bySku: Map<string, number> }> {
  const [{ d }] = (
    await db.execute<{ d: string | null }>(
      onOrBefore
        ? sql`select max(snapshot_date)::text as d from inventory_snapshots where snapshot_date <= ${onOrBefore}`
        : sql`select max(snapshot_date)::text as d from inventory_snapshots`,
    )
  ).rows;
  const bySku = new Map<string, number>();
  if (!d) return { date: null, bySku };
  const rows = (
    await db.execute<{ sku_id: string; s: number }>(
      sql`select sku_id, sum(stock_on_hand)::float as s from inventory_snapshots where snapshot_date = ${d} group by sku_id`,
    )
  ).rows;
  for (const r of rows) bySku.set(r.sku_id, Number(r.s));
  return { date: d, bySku };
}

async function distributorDetail(db: Db, prevWeek: string, lastWeek: string) {
  const rows = (
    await db.execute<{ sku_id: string; distributor_id: string; week_start: string; units: number }>(sql`
      select sku_id, distributor_id, week_start::text, units::float as units from weekly_sales
      where week_start in (${prevWeek}, ${lastWeek}) and distributor_id <> ${ALL_DISTRIBUTORS}`)
  ).rows;
  const out = new Map<string, { previous: Record<string, number>; current: Record<string, number> }>();
  for (const r of rows) {
    const e = out.get(r.sku_id) ?? { previous: {}, current: {} };
    (r.week_start === lastWeek ? e.current : e.previous)[r.distributor_id] = Number(r.units);
    out.set(r.sku_id, e);
  }
  return out;
}

/** Slice a dense series up to and including week index `upto`, dropping weeks before the first sale. */
export const seriesUpTo = (series: (number | null)[], upto: number) =>
  series.slice(0, upto + 1).filter((x): x is number => x !== null);

export interface PlanningInputs {
  lastWeek: string; // last complete sales week (Monday)
  dataAsOf: string; // last day covered by sales data
  planningWeek: string; // the week being planned for
  planningMonth: number; // 1–12; festival uplift applies when this is a festival month
  stockDate: string | null;
  hasDistributorDetail: boolean;
  skus: SkuInfo[];
  inputs: SkuInput[];
  missingStock: string[]; // SKUs with sales but no stock figure (skipped)
}

/** Everything the engine needs for a run on the latest data. */
export async function loadPlanningInputs(db: Db, config: RulesConfig): Promise<PlanningInputs | null> {
  const [skus, history, stock] = await Promise.all([loadSkus(db, config), loadHistory(db), loadStock(db)]);
  if (!history.weeks.length) return null;
  const last = history.weeks.length - 1;
  const lastWeek = history.weeks[last];
  const planningWeek = addDays(lastWeek, 7);
  const detail = history.hasDistributorDetail && last >= 1 ? await distributorDetail(db, history.weeks[last - 1], lastWeek) : null;
  const inputs: SkuInput[] = [];
  const missingStock: string[] = [];
  for (const s of skus) {
    const series = history.bySku.get(s.skuId);
    if (!series) continue; // no sales history at all
    const stockOnHand = stock.bySku.get(s.skuId);
    if (stockOnHand === undefined) {
      missingStock.push(s.skuId);
      continue;
    }
    inputs.push({
      skuId: s.skuId,
      isPerishable: s.isPerishable,
      standardOrderQty: s.standardOrderQty,
      weeklyUnits: seriesUpTo(series, last),
      stockOnHand,
      distributorLastTwoWeeks: detail ? (detail.get(s.skuId) ?? { previous: {}, current: {} }) : undefined,
    });
  }
  return {
    lastWeek,
    dataAsOf: addDays(lastWeek, 6),
    planningWeek,
    planningMonth: Number(monthOfWeek(planningWeek).slice(5, 7)),
    stockDate: stock.date,
    hasDistributorDetail: history.hasDistributorDetail,
    skus,
    inputs,
    missingStock,
  };
}

/** Every stock snapshot: date → SKU → units (summed across locations). Used by the backtest. */
export async function loadStockSnapshots(db: Db): Promise<Map<string, Map<string, number>>> {
  const rows = (
    await db.execute<{ d: string; sku_id: string; s: number }>(
      sql`select snapshot_date::text as d, sku_id, sum(stock_on_hand)::float as s from inventory_snapshots group by 1, 2`,
    )
  ).rows;
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!out.has(r.d)) out.set(r.d, new Map());
    out.get(r.d)!.set(r.sku_id, Number(r.s));
  }
  return out;
}
