import fs from "node:fs";
import { Readable } from "node:stream";
import Papa from "papaparse";
import { sql, max } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import { ALL_DISTRIBUTORS } from "@/lib/db/schema";
import { getActiveRules } from "@/lib/settings";
import { FILE_SPECS, LOAD_ORDER, mapColumns, type ColumnMapping, type FileType } from "./columns";
import { addDays, missingWeeks, monthOfWeek, parseNumber, parseValue } from "./parse";

const BATCH = 1000;
const MAX_STORED_REJECTIONS = 500; // per file; counts are always complete

export type CsvSource = string | Readable; // file path, or a stream (e.g. an uploaded file)

export interface FileReport {
  type: FileType;
  file: string;
  loadId?: number;
  mapping: ColumnMapping;
  rowsRead: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  rejectionsByReason: Record<string, number>;
  sampleRejections: { row: number; reason: string }[];
  warnings: string[];
  dataAsOf?: string;
}

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export interface LoadReport {
  files: FileReport[];
  checks: Check[];
  /** true when a file was not loaded because a required column was missing */
  blocked: boolean;
}

export interface LoadOptions {
  source: "seed" | "sap_csv";
  /** seed: wipe master data, sales and stock first. sap_csv: upsert on top of what's there. */
  replace: boolean;
  /** CSV of sku_id, unit_cost, unit_price used for SKUs whose file has no price (marked 'placeholder'). */
  placeholderPricesFile?: string;
  /** Manual column mapping per file type (field → header), from the SAP upload mapping step. */
  overrides?: Partial<Record<FileType, Record<string, string>>>;
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// CSV reading
// ---------------------------------------------------------------------------

const toStream = (src: CsvSource) => (typeof src === "string" ? fs.createReadStream(src) : src);
const labelOf = (src: CsvSource) => (typeof src === "string" ? src : "upload");

async function* readCsv(src: CsvSource): AsyncGenerator<Record<string, string>> {
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: true, skipEmptyLines: "greedy" });
  const stream = toStream(src).pipe(parser);
  for await (const row of stream) yield row as Record<string, string>;
}

/** First rows + headers, for showing the user what a file contains before loading. */
export async function inspectFile(type: FileType, src: CsvSource, sampleSize = 3) {
  const sample: Record<string, string>[] = [];
  let headers: string[] = [];
  let rows = 0;
  for await (const row of readCsv(src)) {
    if (rows === 0) headers = Object.keys(row);
    if (sample.length < sampleSize) sample.push(row);
    rows++;
  }
  return { headers, rows, sample, mapping: mapColumns(type, headers) };
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

type Converted = { ok: true; value: Record<string, unknown>; extra: Record<string, string> } | { ok: false; error: string };

export function convertRow(type: FileType, record: Record<string, string>, mapping: ColumnMapping): Converted {
  const value: Record<string, unknown> = {};
  for (const f of FILE_SPECS[type].fields) {
    const header = mapping.mapped[f.field];
    const raw = header === undefined ? "" : (record[header] ?? "");
    if (raw.trim() === "") {
      if (f.required) return { ok: false, error: `missing ${f.field}` };
      value[f.field] = null;
      continue;
    }
    const parsed = parseValue(f.type, raw);
    if (!parsed.ok) {
      if (f.required) return { ok: false, error: `${f.field}: ${parsed.error}` };
      value[f.field] = null; // a bad optional value is dropped, not fatal
      continue;
    }
    value[f.field] = parsed.value;
  }
  const extra: Record<string, string> = {};
  for (const h of mapping.unmapped) if (record[h]?.trim()) extra[h] = record[h];
  return { ok: true, value, extra };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

class Reporter {
  report: FileReport;
  pendingRejections: { rowNumber: number; reason: string; raw: unknown }[] = [];
  constructor(type: FileType, file: string, mapping: ColumnMapping) {
    this.report = {
      type, file, mapping, rowsRead: 0, accepted: 0, rejected: 0, duplicates: 0,
      rejectionsByReason: {}, sampleRejections: [], warnings: [],
    };
  }
  reject(row: number, reason: string, raw: unknown) {
    const r = this.report;
    r.rejected++;
    const key = reason.replace(/"[^"]*"/g, '"…"');
    r.rejectionsByReason[key] = (r.rejectionsByReason[key] ?? 0) + 1;
    if (r.sampleRejections.length < 10) r.sampleRejections.push({ row, reason });
    if (r.rejected <= MAX_STORED_REJECTIONS) this.pendingRejections.push({ rowNumber: row, reason, raw });
  }
}

type RowHandler = (v: Record<string, unknown>, extra: Record<string, string>) => string | null | Record<string, unknown>;

interface Ctx {
  db: Db;
  skuIds: Set<string>;
  distributorIds: Set<string>;
  calendarMonths: Set<string>; // "YYYY-MM"
  salesWeeks: Set<string>;
  salesHaveDistributor?: boolean;
  placeholderPrices: Map<string, { unitCost: number; unitPrice: number }>;
  lastSalesWeek?: string;
  opts: LoadOptions;
}

async function insertBatch(ctx: Ctx, type: FileType, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  const { db, opts } = ctx;
  const upsert = !opts.replace;
  const count = (r: unknown[]) => r.length;
  switch (type) {
    case "calendar": {
      const t = schema.calendarMonths;
      const q = db.insert(t).values(rows as (typeof t.$inferInsert)[]);
      return count(await (upsert
        ? q.onConflictDoUpdate({ target: [t.year, t.month], set: { isFestival: sql`excluded.is_festival`, festivalName: sql`excluded.festival_name`, competitorScheme: sql`excluded.competitor_scheme` } })
        : q.onConflictDoNothing()).returning({ k: t.month }));
    }
    case "skus": {
      const t = schema.skus;
      const q = db.insert(t).values(rows as (typeof t.$inferInsert)[]);
      return count(await (upsert
        ? q.onConflictDoUpdate({ target: t.skuId, set: { name: sql`excluded.name`, category: sql`excluded.category`, isPerishable: sql`excluded.is_perishable`, standardOrderQty: sql`excluded.standard_order_qty`, unitCost: sql`excluded.unit_cost`, unitPrice: sql`excluded.unit_price`, priceSource: sql`excluded.price_source`, vendorId: sql`excluded.vendor_id`, active: sql`excluded.active` } })
        : q.onConflictDoNothing()).returning({ k: t.skuId }));
    }
    case "distributors": {
      const t = schema.distributors;
      const q = db.insert(t).values(rows as (typeof t.$inferInsert)[]);
      return count(await (upsert
        ? q.onConflictDoUpdate({ target: t.distributorId, set: { name: sql`excluded.name`, district: sql`excluded.district`, region: sql`excluded.region`, state: sql`excluded.state`, active: sql`excluded.active` } })
        : q.onConflictDoNothing()).returning({ k: t.distributorId }));
    }
    case "weekly_sales": {
      const t = schema.weeklySales;
      const q = db.insert(t).values(rows as (typeof t.$inferInsert)[]);
      return count(await (upsert
        ? q.onConflictDoUpdate({ target: [t.weekStart, t.skuId, t.distributorId], set: { units: sql`excluded.units`, value: sql`excluded.value`, loadId: sql`excluded.load_id` } })
        : q.onConflictDoNothing()).returning({ k: t.skuId }));
    }
    case "inventory": {
      const t = schema.inventorySnapshots;
      const q = db.insert(t).values(rows as (typeof t.$inferInsert)[]);
      return count(await (upsert
        ? q.onConflictDoUpdate({ target: [t.snapshotDate, t.skuId, t.location], set: { stockOnHand: sql`excluded.stock_on_hand`, loadId: sql`excluded.load_id` } })
        : q.onConflictDoNothing()).returning({ k: t.skuId }));
    }
  }
}

/** Per-type validation + shaping into a DB row. Returns a rejection reason string, or the row. */
function handlerFor(type: FileType, ctx: Ctx, loadId: number): RowHandler {
  switch (type) {
    case "calendar":
      return (v, extra) => {
        const [year, month] = [v.year as number, v.month as number];
        if (month < 1 || month > 12) return `month must be 1–12, got ${month}`;
        ctx.calendarMonths.add(`${year}-${String(month).padStart(2, "0")}`);
        return {
          year,
          month,
          isFestival: (v.isFestival as boolean | null) ?? false,
          festivalName: v.festivalName,
          competitorScheme: v.competitorScheme,
          extra,
        };
      };
    case "skus":
      return (v, extra) => {
        if ((v.standardOrderQty as number) <= 0) return "standard order qty must be > 0";
        ctx.skuIds.add(v.skuId as string);
        let priceSource: string | null = v.unitCost != null || v.unitPrice != null ? "file" : null;
        const placeholder = ctx.placeholderPrices.get(v.skuId as string);
        if (!priceSource && placeholder) {
          Object.assign(v, placeholder);
          priceSource = "placeholder";
        }
        return { ...v, priceSource, active: v.active ?? true, extra };
      };
    case "distributors":
      return (v, extra) => {
        ctx.distributorIds.add(v.distributorId as string);
        return { ...v, active: v.active ?? true, extra };
      };
    case "weekly_sales":
      return (v) => {
        if (!ctx.skuIds.has(v.skuId as string)) return `unknown SKU "${v.skuId}"`;
        const hasDistributor = v.distributorId != null;
        if (ctx.salesHaveDistributor && !hasDistributor) return "missing distributorId";
        if (hasDistributor && !ctx.distributorIds.has(v.distributorId as string)) return `unknown distributor "${v.distributorId}"`;
        const week = v.weekStart as string;
        if (ctx.calendarMonths.size && !ctx.calendarMonths.has(monthOfWeek(week))) return `week ${week} falls in ${monthOfWeek(week)}, which is not in the calendar`;
        ctx.salesWeeks.add(week);
        return { weekStart: week, skuId: v.skuId, distributorId: v.distributorId ?? ALL_DISTRIBUTORS, units: v.units, value: v.value, loadId };
      };
    case "inventory":
      return (v) => {
        if (!ctx.skuIds.has(v.skuId as string)) return `unknown SKU "${v.skuId}"`;
        if ((v.stockOnHand as number) < 0) return "negative stock";
        const fallback = ctx.lastSalesWeek ? addDays(ctx.lastSalesWeek, 7) : new Date().toISOString().slice(0, 10);
        return { snapshotDate: v.snapshotDate ?? fallback, skuId: v.skuId, location: v.location ?? "ALL", stockOnHand: v.stockOnHand, loadId };
      };
  }
}

const keyOf = (type: FileType, r: Record<string, unknown>) => {
  switch (type) {
    case "calendar": return `${r.year}-${r.month}`;
    case "skus": return String(r.skuId);
    case "distributors": return String(r.distributorId);
    case "weekly_sales": return `${r.weekStart}|${r.skuId}|${r.distributorId}`;
    case "inventory": return `${r.snapshotDate}|${r.skuId}|${r.location}`;
  }
};

async function loadOne(ctx: Ctx, type: FileType, src: string): Promise<FileReport> {
  const { db, opts } = ctx;
  const log = opts.log ?? (() => {});

  // Peek at headers to build the mapping before touching the database.
  let headers: string[] = [];
  for await (const row of readCsv(src)) {
    headers = Object.keys(row);
    break;
  }
  const mapping = mapColumns(type, headers, opts.overrides?.[type]);
  const rep = new Reporter(type, labelOf(src), mapping);
  if (mapping.missingRequired.length) {
    rep.report.warnings.push(`NOT LOADED — required column(s) missing: ${mapping.missingRequired.join(", ")}`);
    return rep.report;
  }
  if (type === "weekly_sales") {
    ctx.salesHaveDistributor = Boolean(mapping.mapped.distributorId);
    if (!ctx.salesHaveDistributor)
      rep.report.warnings.push("No distributor column: sales loaded per product only; rule 6b (distributor concentration) is off.");
  }

  const [load] = await db
    .insert(schema.dataLoads)
    .values({ source: opts.source, fileName: labelOf(src), fileType: type })
    .returning({ id: schema.dataLoads.id });
  rep.report.loadId = load.id;
  const handle = handlerFor(type, ctx, load.id);

  let batch = new Map<string, Record<string, unknown>>();
  const flush = async () => {
    const rows = [...batch.values()];
    batch = new Map();
    const inserted = await insertBatch(ctx, type, rows);
    rep.report.accepted += inserted;
    rep.report.duplicates += rows.length - inserted;
  };

  let rowNumber = 1; // header is row 1
  for await (const record of readCsv(src)) {
    rowNumber++;
    rep.report.rowsRead++;
    const conv = convertRow(type, record, mapping);
    if (!conv.ok) {
      rep.reject(rowNumber, conv.error, record);
      continue;
    }
    const out = handle(conv.value, conv.extra);
    if (typeof out === "string" || out === null) {
      rep.reject(rowNumber, out ?? "rejected", record);
      continue;
    }
    const key = keyOf(type, out);
    if (batch.has(key)) rep.report.duplicates++; // later row wins within a batch
    batch.set(key, out);
    if (batch.size >= BATCH) await flush();
    if (rep.report.rowsRead % 100_000 === 0) log(`  …${type}: ${rep.report.rowsRead.toLocaleString()} rows read`);
  }
  await flush();

  if (type === "weekly_sales" && ctx.salesWeeks.size) {
    const sorted = [...ctx.salesWeeks].sort();
    ctx.lastSalesWeek = sorted[sorted.length - 1];
    rep.report.dataAsOf = addDays(ctx.lastSalesWeek, 6);
  }
  if (type === "inventory") {
    const [row] = await db.select({ d: max(schema.inventorySnapshots.snapshotDate) }).from(schema.inventorySnapshots);
    rep.report.dataAsOf = row.d ?? undefined;
  }

  await db
    .update(schema.dataLoads)
    .set({
      rowsAccepted: rep.report.accepted,
      rowsRejected: rep.report.rejected,
      dataAsOf: rep.report.dataAsOf,
      summary: { duplicates: rep.report.duplicates, rejectionsByReason: rep.report.rejectionsByReason, mapping: mapping.mapped },
    })
    .where(sql`${schema.dataLoads.id} = ${load.id}`);
  for (let i = 0; i < rep.pendingRejections.length; i += BATCH) {
    await db.insert(schema.rejectedRows).values(
      rep.pendingRejections.slice(i, i + BATCH).map((r) => ({ loadId: load.id, rowNumber: r.rowNumber, reason: r.reason, raw: r.raw })),
    );
  }
  return rep.report;
}

/** Rebuild SKU-level weekly totals from SKU × distributor sales. The rules engine reads this table. */
export async function rebuildSkuWeekly(db: Db) {
  await db.execute(sql`delete from sku_weekly_sales`);
  await db.execute(sql`
    insert into sku_weekly_sales (week_start, sku_id, units, distributor_count)
    select week_start, sku_id, sum(units),
           count(distinct distributor_id) filter (where distributor_id <> ${ALL_DISTRIBUTORS})
    from weekly_sales group by week_start, sku_id`);
}

async function loadIdSets(db: Db, ctx: Ctx) {
  for (const r of await db.select({ id: schema.skus.skuId }).from(schema.skus)) ctx.skuIds.add(r.id);
  for (const r of await db.select({ id: schema.distributors.distributorId }).from(schema.distributors)) ctx.distributorIds.add(r.id);
  for (const r of await db.select().from(schema.calendarMonths)) ctx.calendarMonths.add(`${r.year}-${String(r.month).padStart(2, "0")}`);
}

async function runChecks(db: Db, ctx: Ctx, reports: FileReport[]): Promise<Check[]> {
  const checks: Check[] = [];
  const sales = reports.find((r) => r.type === "weekly_sales");
  const inv = reports.find((r) => r.type === "inventory");

  if (sales) {
    const unknownSku = Object.entries(sales.rejectionsByReason).filter(([k]) => k.startsWith("unknown SKU")).reduce((a, [, n]) => a + n, 0);
    const unknownDist = Object.entries(sales.rejectionsByReason).filter(([k]) => k.startsWith("unknown distributor")).reduce((a, [, n]) => a + n, 0);
    checks.push({ name: "Every sales row's SKU exists in the SKU file", passed: unknownSku === 0, detail: `${unknownSku} row(s) rejected` });
    checks.push(
      ctx.salesHaveDistributor
        ? { name: "Every sales row's distributor exists in the distributor file", passed: unknownDist === 0, detail: `${unknownDist} row(s) rejected` }
        : { name: "Every sales row's distributor exists in the distributor file", passed: true, detail: "n/a — sales have no distributor column (product-level)" },
    );
    const offCalendar = Object.entries(sales.rejectionsByReason).filter(([k]) => k.includes("not in the calendar")).reduce((a, [, n]) => a + n, 0);
    if (ctx.calendarMonths.size)
      checks.push({ name: "Every sales week falls in a calendar month", passed: offCalendar === 0, detail: `${offCalendar} row(s) rejected` });

    // Missing weeks: every 7-day step between the first and last sales week, per file and per SKU.
    const weeks = (await db.selectDistinct({ w: schema.weeklySales.weekStart }).from(schema.weeklySales)).map((r) => r.w).sort();
    const gaps = missingWeeks(weeks);
    const first = weeks[0];
    const offGrid = first
      ? weeks.filter((w) => Math.round((Date.parse(w) - Date.parse(first)) / 86_400_000) % 7 !== 0)
      : [];
    const allGaps = gaps;
    checks.push({
      name: "No missing weeks in sales",
      passed: allGaps.length === 0 && offGrid.length === 0,
      detail: weeks.length
        ? `${weeks.length} weeks, ${first} → ${weeks[weeks.length - 1]}` +
          (allGaps.length ? `; missing: ${allGaps.slice(0, 12).join(", ")}${allGaps.length > 12 ? ` (+${allGaps.length - 12} more)` : ""}` : "") +
          (offGrid.length ? `; not on a 7-day grid: ${offGrid.slice(0, 5).join(", ")}` : "")
        : "no sales loaded",
    });
    // Per SKU: weeks inside the SKU's own sales range with no row (a gap, not a late launch).
    const skuGaps = (
      await db.execute<{ sku_id: string; missing: number }>(sql`
        select sku_id, ((max(week_start) - min(week_start)) / 7 + 1 - count(*))::int as missing
        from sku_weekly_sales group by sku_id having (max(week_start) - min(week_start)) / 7 + 1 > count(*)`)
    ).rows;
    checks.push({
      name: "No missing weeks within each SKU's history",
      passed: skuGaps.length === 0,
      detail: skuGaps.length ? skuGaps.slice(0, 10).map((r) => `${r.sku_id}: ${r.missing} week(s)`).join(", ") : "all SKUs continuous",
    });
  }
  if (inv) {
    const neg = inv.rejectionsByReason["negative stock"] ?? 0;
    checks.push({ name: "No negative stock", passed: neg === 0, detail: `${neg} row(s) rejected` });
    const [{ n }] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from skus s
      where s.active and not exists (select 1 from inventory_snapshots i where i.sku_id = s.sku_id)`).then((r) => r.rows);
    checks.push({ name: "Every active SKU has a stock figure", passed: n === 0, detail: `${n} active SKU(s) without stock` });
  }
  if (reports.some((r) => r.type === "calendar") && ctx.calendarMonths.size) {
    const festive = await db.selectDistinct({ m: schema.calendarMonths.month }).from(schema.calendarMonths).where(sql`${schema.calendarMonths.isFestival}`);
    const fromCalendar = festive.map((r) => r.m).sort((a, b) => a - b);
    const fromRules = [...(await getActiveRules()).config.festival.months].sort((a, b) => a - b);
    checks.push({
      name: "Calendar festival months match the rules config",
      passed: fromCalendar.join() === fromRules.join(),
      detail: `calendar: ${fromCalendar.join(", ") || "none"} · rules: ${fromRules.join(", ")}`,
    });
  }
  if (reports.some((r) => r.type === "skus")) {
    const rows = (await db.execute<{ src: string | null; n: number }>(sql`select price_source as src, count(*)::int as n from skus group by 1`)).rows;
    const n = (k: string | null) => rows.find((r) => r.src === k)?.n ?? 0;
    checks.push({
      name: "Every SKU has a unit cost/price",
      passed: n(null) === 0,
      detail: `${n("file")} from file, ${n("placeholder")} placeholder (₹ figures marked estimated), ${n(null)} missing`,
    });
  }
  return checks;
}

async function readPlaceholderPrices(file?: string) {
  const map = new Map<string, { unitCost: number; unitPrice: number }>();
  if (!file || !fs.existsSync(file)) return map;
  for await (const r of readCsv(file)) {
    const cost = parseNumber(r.unit_cost ?? "");
    const price = parseNumber(r.unit_price ?? "");
    if (r.sku_id && cost.ok && price.ok) map.set(r.sku_id.trim(), { unitCost: cost.value, unitPrice: price.value });
  }
  return map;
}

/** Load any subset of the five files, in dependency order, validating as it goes. */
export async function loadFiles(files: Partial<Record<FileType, string>>, opts: LoadOptions): Promise<LoadReport> {
  const db = await getDb();
  const log = opts.log ?? (() => {});
  const ctx: Ctx = {
    db, skuIds: new Set(), distributorIds: new Set(), calendarMonths: new Set(), salesWeeks: new Set(), opts,
    placeholderPrices: await readPlaceholderPrices(opts.placeholderPricesFile),
  };

  if (opts.replace) {
    log("Clearing master data, sales and stock …");
    await db.execute(sql`truncate table weekly_sales, sku_weekly_sales, inventory_snapshots, calendar_months, distributors, skus, rejected_rows, data_loads restart identity cascade`);
  } else {
    await loadIdSets(db, ctx);
  }

  const reports: FileReport[] = [];
  let blocked = false;
  for (const type of LOAD_ORDER) {
    const src = files[type];
    if (!src) continue;
    log(`Loading ${type} from ${src} …`);
    const r = await loadOne(ctx, type, src);
    if (r.mapping.missingRequired.length) blocked = true;
    reports.push(r);
  }
  if (files.weekly_sales) {
    log("Rebuilding SKU-level weekly totals …");
    await rebuildSkuWeekly(db);
  }
  const checks = await runChecks(db, ctx, reports);
  return { files: reports, checks, blocked };
}

export function formatReport(rep: LoadReport): string {
  const lines: string[] = [];
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  lines.push("", "File            Read   Accepted  Rejected  Duplicates  Data as of");
  lines.push("─".repeat(70));
  for (const f of rep.files) {
    lines.push(
      `${f.type.padEnd(14)}${pad(f.rowsRead.toLocaleString("en-IN"), 7)}${pad(f.accepted.toLocaleString("en-IN"), 11)}${pad(f.rejected, 10)}${pad(f.duplicates, 12)}  ${f.dataAsOf ?? ""}`,
    );
  }
  for (const f of rep.files) {
    if (!f.rejected && !f.warnings.length && !f.mapping.unmapped.length) continue;
    lines.push("", `▸ ${f.type} (${f.file})`);
    for (const w of f.warnings) lines.push(`  ⚠ ${w}`);
    if (f.mapping.unmapped.length) lines.push(`  unmapped columns kept as extra: ${f.mapping.unmapped.join(", ")}`);
    for (const [reason, n] of Object.entries(f.rejectionsByReason)) lines.push(`  rejected ${n} × ${reason}`);
    for (const s of f.sampleRejections.slice(0, 5)) lines.push(`    e.g. row ${s.row}: ${s.reason}`);
  }
  lines.push("", "Checks");
  for (const c of rep.checks) lines.push(`  ${c.passed ? "✓" : "✗"} ${c.name} — ${c.detail}`);
  return lines.join("\n");
}
