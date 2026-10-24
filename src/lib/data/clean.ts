import { addDays } from "@/lib/dates";
import type { ColumnMap } from "./columns";
import { cleanId, parseBool, parseDate, parseNumber, parseWeek, parseYearMonth } from "./parse";

/**
 * Turns raw CSV rows into clean records. Pure functions: nothing here touches the database, so every
 * validation rule is unit-tested. Row numbers match the file (header = row 1).
 */

export interface Rejected { row: number; reason: string }
export interface Cleaned<T> { records: T[]; rejected: Rejected[]; warnings: string[] }

type Row = Record<string, string>;
const get = (row: Row, map: ColumnMap, field: string) => (map[field] ? row[map[field]!] ?? "" : "");

export interface SkuRecord {
  id: string; name: string; category: string | null; perishable: boolean; standardOrderQty: number;
  unit: string; supplierId: string | null; unitCost: number | null; unitPrice: number | null;
}
export interface DistributorRecord { id: string; name: string; region: string | null; status: string | null }
export interface CalendarRecord { yearMonth: string; isFestival: boolean; festivalName: string | null; competitorScheme: string | null }
export interface StockRecord { skuId: string; asOf: string; location: string; units: number }
export interface SalesRecord { weekStart: string; skuId: string; distributorId: string; units: number }
export interface PriceRecord { skuId: string; unitCost: number; unitPrice: number }
export interface PlannerHistoryRecord { weekStart: string; skuId: string; flag: string }

export const ALL_DISTRIBUTORS = "ALL";

function dedupe<T>(records: T[], key: (r: T) => string, warnings: string[], what: string): T[] {
  const byKey = new Map<string, T>();
  for (const r of records) byKey.set(key(r), r); // last one wins
  const dupes = records.length - byKey.size;
  if (dupes) warnings.push(`${dupes} duplicate ${what} row(s): the last one in the file was kept.`);
  return [...byKey.values()];
}

export function cleanSkus(rows: Row[], map: ColumnMap): Cleaned<SkuRecord> {
  const records: SkuRecord[] = [];
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  rows.forEach((row, i) => {
    const r = i + 2;
    const id = cleanId(get(row, map, "id"));
    const name = get(row, map, "name");
    const perishable = parseBool(get(row, map, "perishable"));
    const qty = parseNumber(get(row, map, "standardOrderQty"));
    const cost = parseNumber(get(row, map, "unitCost"));
    const price = parseNumber(get(row, map, "unitPrice"));
    if (!id) return rejected.push({ row: r, reason: "SKU id is missing" });
    if (!name) return rejected.push({ row: r, reason: `${id}: name is missing` });
    if (perishable == null) return rejected.push({ row: r, reason: `${id}: perishability "${get(row, map, "perishable")}" not understood (use High/Low or Y/N)` });
    if (qty == null || Number.isNaN(qty) || qty <= 0) return rejected.push({ row: r, reason: `${id}: standard order quantity must be a number above 0` });
    if (Number.isNaN(cost) || Number.isNaN(price)) return rejected.push({ row: r, reason: `${id}: unit cost/price is not a number` });
    records.push({
      id, name, perishable, standardOrderQty: qty,
      category: get(row, map, "category") || null,
      unit: get(row, map, "unit") || "Units",
      supplierId: cleanId(get(row, map, "supplier")) || null,
      unitCost: cost, unitPrice: price,
    });
  });
  return { records: dedupe(records, (s) => s.id, warnings, "SKU"), rejected, warnings };
}

export function cleanDistributors(rows: Row[], map: ColumnMap): Cleaned<DistributorRecord> {
  const records: DistributorRecord[] = [];
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  rows.forEach((row, i) => {
    const id = cleanId(get(row, map, "id"));
    const name = get(row, map, "name");
    if (!id || !name) return rejected.push({ row: i + 2, reason: "distributor id or name is missing" });
    if (id === ALL_DISTRIBUTORS) return rejected.push({ row: i + 2, reason: `"${ALL_DISTRIBUTORS}" is reserved` });
    records.push({ id, name, region: get(row, map, "region") || null, status: get(row, map, "status") || null });
  });
  return { records: dedupe(records, (d) => d.id, warnings, "distributor"), rejected, warnings };
}

export function cleanCalendar(rows: Row[], map: ColumnMap): Cleaned<CalendarRecord> {
  const records: CalendarRecord[] = [];
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  rows.forEach((row, i) => {
    const ym = parseYearMonth(get(row, map, "yearMonth")) ??
      parseYearMonth(`${get(row, map, "year")}-${get(row, map, "month")}`);
    if (!ym) return rejected.push({ row: i + 2, reason: "year/month not understood" });
    records.push({
      yearMonth: ym,
      isFestival: parseBool(get(row, map, "isFestival")) ?? false,
      festivalName: get(row, map, "festivalName") || null,
      competitorScheme: get(row, map, "competitorScheme") || null,
    });
  });
  return { records: dedupe(records, (c) => c.yearMonth, warnings, "calendar"), rejected, warnings };
}

export function cleanInventory(rows: Row[], map: ColumnMap, ctx: { knownSkus: Set<string>; defaultAsOf: string }): Cleaned<StockRecord> {
  const records: StockRecord[] = [];
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  rows.forEach((row, i) => {
    const r = i + 2;
    const skuId = cleanId(get(row, map, "sku"));
    const units = parseNumber(get(row, map, "units"));
    const rawDate = get(row, map, "asOf");
    const asOf = rawDate ? parseDate(rawDate) : ctx.defaultAsOf;
    if (!skuId) return rejected.push({ row: r, reason: "SKU is missing" });
    if (!ctx.knownSkus.has(skuId)) return rejected.push({ row: r, reason: `${skuId}: not in the SKU master` });
    if (units == null || Number.isNaN(units)) return rejected.push({ row: r, reason: `${skuId}: stock is not a number` });
    if (units < 0) return rejected.push({ row: r, reason: `${skuId}: negative stock (${units})` });
    if (!asOf) return rejected.push({ row: r, reason: `${skuId}: date "${rawDate}" not understood` });
    records.push({ skuId, asOf, location: get(row, map, "location") || "ALL", units });
  });
  const kept = dedupe(records, (s) => `${s.asOf}|${s.skuId}|${s.location}`, warnings, "stock");
  const covered = new Set(kept.map((s) => s.skuId));
  const missing = [...ctx.knownSkus].filter((s) => !covered.has(s));
  if (missing.length) warnings.push(`No stock figure for ${missing.length} SKU(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}. They go to the exceptions queue.`);
  return { records: kept, rejected, warnings };
}

/**
 * Sales rows. Several rows for the same week × SKU × distributor (e.g. one per SAP billing line) are added up.
 * Without a distributor column, sales are SKU-level (distributor "ALL").
 */
export function cleanSales(
  rows: Row[], map: ColumnMap,
  ctx: { knownSkus: Set<string>; knownDistributors: Set<string>; calendarMonths?: Set<string> },
): Cleaned<SalesRecord> {
  const sums = new Map<string, SalesRecord>();
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  let lines = 0;
  rows.forEach((row, i) => {
    const r = i + 2;
    const rawWeek = get(row, map, "week");
    const weekStart = parseWeek(rawWeek);
    const skuId = cleanId(get(row, map, "sku"));
    const distributorId = map.distributor ? cleanId(get(row, map, "distributor")) : ALL_DISTRIBUTORS;
    const units = parseNumber(get(row, map, "units"));
    if (!weekStart) return rejected.push({ row: r, reason: `week "${rawWeek}" not understood` });
    if (!skuId) return rejected.push({ row: r, reason: "SKU is missing" });
    if (!ctx.knownSkus.has(skuId)) return rejected.push({ row: r, reason: `${skuId}: not in the SKU master` });
    if (!distributorId) return rejected.push({ row: r, reason: `${skuId}: distributor is missing` });
    if (distributorId !== ALL_DISTRIBUTORS && !ctx.knownDistributors.has(distributorId))
      return rejected.push({ row: r, reason: `${distributorId}: not in the distributor master` });
    if (units == null || Number.isNaN(units)) return rejected.push({ row: r, reason: `${skuId}: units is not a number` });
    lines++;
    const key = `${weekStart}|${skuId}|${distributorId}`;
    const prev = sums.get(key);
    if (prev) prev.units += units;
    else sums.set(key, { weekStart, skuId, distributorId, units });
  });
  const records = [...sums.values()];
  if (lines > records.length) warnings.push(`${lines - records.length} row(s) for the same week × SKU × distributor were added together.`);
  if (records.some((s) => s.units < 0)) warnings.push("Some weeks have negative net units (returns exceed sales); kept as is.");
  if (ctx.calendarMonths?.size) {
    const outside = new Set(records.map((s) => addDays(s.weekStart, 3).slice(0, 7)).filter((m) => !ctx.calendarMonths!.has(m)));
    if (outside.size) warnings.push(`Sales fall in months missing from the calendar: ${[...outside].sort().join(", ")}.`);
  }
  warnings.push(...missingWeeks(records));
  return { records, rejected, warnings };
}

/** "No missing weeks": every 7-day step between the first and last week has data, overall and per SKU. */
export function missingWeeks(records: { weekStart: string; skuId: string }[]): string[] {
  if (!records.length) return [];
  const out: string[] = [];
  const all = new Set(records.map((r) => r.weekStart));
  const weeks = [...all].sort();
  const gaps: string[] = [];
  for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w = addDays(w, 7)) if (!all.has(w)) gaps.push(w);
  if (gaps.length) out.push(`Missing weeks in the file: ${gaps.join(", ")}.`);
  const last = weeks[weeks.length - 1];
  const bySku = new Map<string, Set<string>>();
  for (const r of records) (bySku.get(r.skuId) ?? bySku.set(r.skuId, new Set()).get(r.skuId)!).add(r.weekStart);
  const skuGaps: string[] = [];
  for (const [sku, set] of bySku) {
    const sorted = [...set].sort();
    let missing = 0;
    for (let w = sorted[0]; w <= last; w = addDays(w, 7)) if (!set.has(w) && !gaps.includes(w)) missing++;
    if (missing) skuGaps.push(`${sku} (${missing})`);
  }
  if (skuGaps.length) out.push(`SKUs with weeks missing (read as zero sales): ${skuGaps.slice(0, 15).join(", ")}${skuGaps.length > 15 ? "…" : ""}.`);
  return out;
}

export function cleanPrices(rows: Row[], map: ColumnMap, ctx: { knownSkus: Set<string> }): Cleaned<PriceRecord> {
  const records: PriceRecord[] = [];
  const rejected: Rejected[] = [];
  rows.forEach((row, i) => {
    const skuId = cleanId(get(row, map, "sku"));
    const unitCost = parseNumber(get(row, map, "unitCost"));
    const unitPrice = parseNumber(get(row, map, "unitPrice"));
    if (!ctx.knownSkus.has(skuId)) return rejected.push({ row: i + 2, reason: `${skuId || "(blank)"}: not in the SKU master` });
    if (unitCost == null || unitPrice == null || Number.isNaN(unitCost) || Number.isNaN(unitPrice) || unitCost < 0 || unitPrice < 0)
      return rejected.push({ row: i + 2, reason: `${skuId}: cost/price must be numbers ≥ 0` });
    records.push({ skuId, unitCost, unitPrice });
  });
  return { records, rejected, warnings: [] };
}

const HISTORY_FLAGS = new Set(["HIGH_DEMAND", "STOCKOUT_RISK", "OVERSTOCK_RISK", "NONE"]);

export function cleanPlannerHistory(rows: Row[], map: ColumnMap, ctx: { knownSkus: Set<string> }): Cleaned<PlannerHistoryRecord> {
  const records: PlannerHistoryRecord[] = [];
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  rows.forEach((row, i) => {
    const weekStart = parseWeek(get(row, map, "week"));
    const skuId = cleanId(get(row, map, "sku"));
    const flag = get(row, map, "flag").toUpperCase().replace(/[\s-]+/g, "_");
    if (!weekStart) return rejected.push({ row: i + 2, reason: "week not understood" });
    if (!ctx.knownSkus.has(skuId)) return rejected.push({ row: i + 2, reason: `${skuId}: not in the SKU master` });
    if (!HISTORY_FLAGS.has(flag)) return rejected.push({ row: i + 2, reason: `flag "${flag}" must be one of ${[...HISTORY_FLAGS].join(", ")}` });
    records.push({ weekStart, skuId, flag });
  });
  return { records: dedupe(records, (h) => `${h.weekStart}|${h.skuId}|${h.flag}`, warnings, "history"), rejected, warnings };
}
