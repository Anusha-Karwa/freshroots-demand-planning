import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays } from "@/lib/dates";
import { autoMap, FILE_KINDS, missingRequired, type ColumnMap, type FileKind } from "./columns";
import { readCsv } from "./parse";
import {
  cleanCalendar, cleanDistributors, cleanInventory, cleanPlannerHistory, cleanPrices, cleanSales, cleanSkus,
  type Cleaned, type Rejected,
} from "./clean";

export interface LoadSummary {
  kind: FileKind;
  filename: string;
  rows: number;
  accepted: number;
  rejected: Rejected[];
  warnings: string[];
  missingColumns: string[];
}

/** replace = seed load (sales and stock are replaced); merge = SAP upload (adds to / updates what's there). */
export type LoadMode = "replace" | "merge";

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

const ids = async (db: Db, table: typeof schema.skus | typeof schema.distributors) =>
  new Set((await db.select({ id: table.id }).from(table)).map((r) => r.id));

/** The day after the latest sales week ends: the default "as of" date for a stock file without dates. */
async function defaultStockDate(db: Db) {
  const [row] = await db.select({ last: max(schema.weeklySales.weekStart) }).from(schema.weeklySales);
  return row?.last ? addDays(row.last, 7) : new Date().toISOString().slice(0, 10);
}

/** Cleans one CSV and writes it. With no column map, headers are matched automatically. */
export async function loadCsv(
  db: Db, kind: FileKind, text: string,
  opts: { map?: ColumnMap; mode: LoadMode; by: string; source: string; filename: string; pricesArePlaceholder?: boolean },
): Promise<LoadSummary> {
  const { headers, rows } = readCsv(text);
  const map = opts.map ?? autoMap(kind, headers);
  const summary: LoadSummary = { kind, filename: opts.filename, rows: rows.length, accepted: 0, rejected: [], warnings: [], missingColumns: missingRequired(kind, map) };
  if (summary.missingColumns.length) return summary;

  let cleaned: Cleaned<unknown>;
  switch (kind) {
    case "skus": {
      const c = cleanSkus(rows, map);
      cleaned = c;
      await insertChunks(c.records, (chunk) => db.insert(schema.skus).values(chunk.map((s) => ({
        ...s, priceSource: s.unitCost != null && s.unitPrice != null ? "file" : "placeholder", active: true,
      }))).onConflictDoUpdate({
        target: schema.skus.id,
        set: {
          name: sql`excluded.name`, category: sql`excluded.category`, perishable: sql`excluded.perishable`,
          standardOrderQty: sql`excluded.standard_order_qty`, unit: sql`excluded.unit`, supplierId: sql`excluded.supplier_id`,
          // A file without prices keeps the prices already loaded.
          unitCost: sql`coalesce(excluded.unit_cost, ${schema.skus.unitCost})`,
          unitPrice: sql`coalesce(excluded.unit_price, ${schema.skus.unitPrice})`,
          priceSource: sql`case when excluded.unit_cost is not null then 'file' else ${schema.skus.priceSource} end`,
          active: sql`true`,
        },
      }));
      if (opts.mode === "replace" && c.records.length) {
        await db.update(schema.skus).set({ active: false }).where(notInArray(schema.skus.id, c.records.map((s) => s.id)));
      }
      break;
    }
    case "distributors": {
      const c = cleanDistributors(rows, map);
      cleaned = c;
      await insertChunks(c.records, (chunk) => db.insert(schema.distributors).values(chunk).onConflictDoUpdate({
        target: schema.distributors.id,
        set: { name: sql`excluded.name`, region: sql`excluded.region`, status: sql`excluded.status` },
      }));
      break;
    }
    case "calendar": {
      const c = cleanCalendar(rows, map);
      cleaned = c;
      if (opts.mode === "replace") await db.delete(schema.calendarMonths);
      await insertChunks(c.records, (chunk) => db.insert(schema.calendarMonths).values(chunk).onConflictDoUpdate({
        target: schema.calendarMonths.yearMonth,
        set: { isFestival: sql`excluded.is_festival`, festivalName: sql`excluded.festival_name`, competitorScheme: sql`excluded.competitor_scheme` },
      }));
      break;
    }
    case "sales": {
      const calendar = new Set((await db.select({ m: schema.calendarMonths.yearMonth }).from(schema.calendarMonths)).map((r) => r.m));
      const c = cleanSales(rows, map, { knownSkus: await ids(db, schema.skus), knownDistributors: await ids(db, schema.distributors), calendarMonths: calendar });
      cleaned = c;
      if (opts.mode === "replace") await db.delete(schema.weeklySales);
      else {
        // The newest file wins for every week × SKU it contains (SKU-level and distributor-level rows alike).
        const byWeek = new Map<string, Set<string>>();
        for (const s of c.records) (byWeek.get(s.weekStart) ?? byWeek.set(s.weekStart, new Set()).get(s.weekStart)!).add(s.skuId);
        for (const [week, skuSet] of byWeek)
          await db.delete(schema.weeklySales).where(and(eq(schema.weeklySales.weekStart, week), inArray(schema.weeklySales.skuId, [...skuSet])));
      }
      await insertChunks(c.records, (chunk) => db.insert(schema.weeklySales).values(chunk));
      // A newest week that only covers some SKUs makes the rest look like zero sales.
      const [latest] = await db.select({ w: max(schema.weeklySales.weekStart) }).from(schema.weeklySales);
      if (latest?.w) {
        const covered = new Set((await db.selectDistinct({ s: schema.weeklySales.skuId }).from(schema.weeklySales).where(eq(schema.weeklySales.weekStart, latest.w))).map((r) => r.s));
        const missing = [...(await activeSkus(db))].filter((s) => !covered.has(s));
        if (missing.length) c.warnings.push(`The newest week (${latest.w}) has no sales for ${missing.length} SKU(s) (${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}); the rules read that as zero sales. Upload the full week before the next run.`);
      }
      break;
    }
    case "inventory": {
      const c = cleanInventory(rows, map, { knownSkus: await activeSkus(db), defaultAsOf: await defaultStockDate(db) });
      cleaned = c;
      if (opts.mode === "replace") await db.delete(schema.stockSnapshots);
      await insertChunks(c.records, (chunk) => db.insert(schema.stockSnapshots).values(chunk).onConflictDoUpdate({
        target: [schema.stockSnapshots.asOf, schema.stockSnapshots.skuId, schema.stockSnapshots.location],
        set: { units: sql`excluded.units` },
      }));
      break;
    }
    case "prices": {
      const c = cleanPrices(rows, map, { knownSkus: await ids(db, schema.skus) });
      cleaned = c;
      const source = opts.pricesArePlaceholder ? "placeholder" : "file";
      for (const p of c.records) {
        const where = eq(schema.skus.id, p.skuId);
        // Placeholder prices never overwrite real ones.
        const cond = opts.pricesArePlaceholder ? and(where, eq(schema.skus.priceSource, "placeholder")) : where;
        await db.update(schema.skus).set({ unitCost: p.unitCost, unitPrice: p.unitPrice, priceSource: source }).where(cond);
      }
      break;
    }
    case "planner_history": {
      const c = cleanPlannerHistory(rows, map, { knownSkus: await ids(db, schema.skus) });
      cleaned = c;
      if (opts.mode === "replace") await db.delete(schema.plannerHistory);
      await insertChunks(c.records, (chunk) => db.insert(schema.plannerHistory).values(chunk).onConflictDoNothing());
      break;
    }
  }

  summary.accepted = cleaned.records.length;
  summary.rejected = cleaned.rejected;
  summary.warnings = cleaned.warnings;
  await db.insert(schema.dataLoads).values({
    source: opts.source, kind, filename: opts.filename, accepted: summary.accepted, rejected: summary.rejected.length,
    summary: { warnings: summary.warnings, rejected: summary.rejected.slice(0, 50), rows: summary.rows }, loadedBy: opts.by,
  });
  return summary;
}

async function activeSkus(db: Db) {
  return new Set((await db.select({ id: schema.skus.id }).from(schema.skus).where(eq(schema.skus.active, true))).map((r) => r.id));
}

// The seed files ship with the deployment via outputFileTracingIncludes (next.config.ts), so the bundler
// needn't trace these paths.
const exists = (file: string) => fs.existsSync(/*turbopackIgnore: true*/ file);
const read = (file: string) => fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");

export const SEED_DIR = path.join(process.cwd(), "data", "seed");
export const PLACEHOLDER_PRICES = path.join(process.cwd(), "data", "placeholder_prices.csv");

/** Order matters: masters first, so sales and stock can be checked against them. */
const SEED_ORDER: FileKind[] = ["skus", "distributors", "calendar", "sales", "inventory"];

/** Loads the five seed files (+ placeholder prices). Sales and stock are replaced; masters are upserted. */
export async function loadSeed(db: Db, by: string, dir = SEED_DIR, files: Partial<Record<FileKind, string>> = {}) {
  const summaries: LoadSummary[] = [];
  for (const kind of SEED_ORDER) {
    const file = files[kind] ?? path.join(/*turbopackIgnore: true*/ dir, FILE_KINDS[kind].seedFile!);
    if (!exists(file)) {
      summaries.push({ kind, filename: path.basename(file), rows: 0, accepted: 0, rejected: [], warnings: ["File not found — skipped."], missingColumns: [] });
      continue;
    }
    summaries.push(await loadCsv(db, kind, read(file), { mode: "replace", by, source: "seed", filename: path.basename(file) }));
    if (kind === "skus" && exists(PLACEHOLDER_PRICES)) {
      summaries.push(await loadCsv(db, "prices", read(PLACEHOLDER_PRICES), {
        mode: "merge", by, source: "seed", filename: "placeholder_prices.csv", pricesArePlaceholder: true,
      }));
    }
  }
  const history = path.join(/*turbopackIgnore: true*/ dir, "planner_history.csv");
  if (exists(history))
    summaries.push(await loadCsv(db, "planner_history", read(history), { mode: "replace", by, source: "seed", filename: "planner_history.csv" }));
  return summaries;
}

export function formatSummaries(summaries: LoadSummary[]) {
  const lines: string[] = [];
  for (const s of summaries) {
    lines.push(`${FILE_KINDS[s.kind].label} (${s.filename}): ${s.rows} rows → ${s.accepted} loaded, ${s.rejected.length} rejected`);
    if (s.missingColumns.length) lines.push(`  ✗ missing columns: ${s.missingColumns.join(", ")}`);
    for (const r of s.rejected.slice(0, 20)) lines.push(`  ✗ row ${r.row}: ${r.reason}`);
    if (s.rejected.length > 20) lines.push(`  … ${s.rejected.length - 20} more rejected`);
    for (const w of s.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join("\n");
}
