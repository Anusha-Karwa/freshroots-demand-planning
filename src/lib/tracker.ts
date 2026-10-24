import { and, desc, eq, lt, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays, todayIst } from "@/lib/dates";
import { computeKillSwitch, type KillSwitch } from "@/lib/killswitch";
import { loadEngineData, latestStock, latestSalesWeek } from "@/lib/forecast/inputs";
import { evaluateSku } from "@/lib/rules/engine";
import { getBaseline, getRules } from "@/lib/settings";
import { notifyKillSwitchRed } from "@/lib/notify";
import { syncPurchaseOrderStatuses } from "@/lib/purchase-orders";

/**
 * The daily early warning (07:00 IST): actual units in the latest loaded week vs what the plan expected for it,
 * per SKU. SAP sales arrive weekly, so the numbers move when a new week is loaded; the check itself runs daily.
 * Also: auto-detects stockouts, syncs PO statuses from Zoho and recomputes the kill switch.
 */

export type TrackStatus = "on_track" | "above" | "below" | "stockout";

/** Pure; exported for tests. */
export function classify(actual: number, forecast: number, stock: number | null, thresholdPct: number): { status: TrackStatus; variancePct: number | null } {
  const variancePct = forecast > 0 ? ((actual - forecast) / forecast) * 100 : actual > 0 ? null : 0;
  if (stock === 0 && (actual > 0 || forecast > 0)) return { status: "stockout", variancePct };
  if (variancePct == null) return { status: "above", variancePct };
  if (variancePct > thresholdPct) return { status: "above", variancePct };
  if (variancePct < -thresholdPct) return { status: "below", variancePct };
  return { status: "on_track", variancePct };
}

/**
 * The forecast for a week: the expectedWeekly of the latest run made on data before that week. Weeks no run
 * planned (e.g. history loaded at once) are re-planned by running the rules on the weeks before them.
 */
async function forecastsFor(db: Db, week: string): Promise<{ bySku: Map<string, number>; source: string }> {
  const [run] = await db.select().from(schema.runs)
    .where(and(eq(schema.runs.status, "done"), lt(schema.runs.dataThrough, week)))
    .orderBy(desc(schema.runs.id)).limit(1);
  if (run) {
    const items = await db.select({ skuId: schema.runItems.skuId, f: schema.runItems.forecastWeekly }).from(schema.runItems).where(eq(schema.runItems.runId, run.id));
    return { bySku: new Map(items.map((i) => [i.skuId, i.f])), source: `run #${run.id}` };
  }
  const rules = await getRules(db);
  const data = await loadEngineData(db, { throughWeek: addDays(week, -7) });
  const bySku = new Map(data.inputs.filter((i) => i.weekly.length).map((i) => [i.skuId, evaluateSku(i, rules.config, week).metrics.expectedWeekly]));
  return { bySku, source: "rules re-run on prior weeks" };
}

export async function runTracker(db: Db, opts: { today?: string; notify?: boolean } = {}) {
  const today = opts.today ?? todayIst();
  const week = await latestSalesWeek(db);
  const baseline = await getBaseline(db);
  let checked = 0;
  let incidents = 0;
  let forecastSource = "";

  if (week) {
    const { bySku: forecasts, source } = await forecastsFor(db, week);
    forecastSource = source;
    const actualRows = await db.select().from(schema.weeklySales).where(eq(schema.weeklySales.weekStart, week));
    const actual = new Map<string, number>();
    for (const r of actualRows) actual.set(r.skuId, (actual.get(r.skuId) ?? 0) + r.units);
    const { stock } = await latestStock(db);
    const skus = await db.select().from(schema.skus).where(eq(schema.skus.active, true));

    for (const sku of skus) {
      const f = forecasts.get(sku.id);
      if (f == null) continue;
      const a = actual.get(sku.id) ?? 0;
      const s = stock.get(sku.id) ?? null;
      const { status, variancePct } = classify(a, f, s, baseline.trackerVariancePct);
      const row = {
        checkDate: today, skuId: sku.id, weekStart: week, actualUnits: a, forecastUnits: f, variancePct,
        stockUnits: s, weeksCover: s != null && f > 0 ? s / f : null, status,
      };
      await db.insert(schema.trackerChecks).values(row).onConflictDoUpdate({
        target: [schema.trackerChecks.checkDate, schema.trackerChecks.skuId],
        set: { weekStart: row.weekStart, actualUnits: a, forecastUnits: f, variancePct, stockUnits: s, weeksCover: row.weeksCover, status },
      });
      checked++;

      // A SKU out of stock while there is demand: log one incident per SKU-week, valued at a week of forecast sales.
      if (status === "stockout") {
        const [existing] = await db.select().from(schema.stockoutIncidents)
          .where(and(eq(schema.stockoutIncidents.skuId, sku.id), eq(schema.stockoutIncidents.weekStart, week), eq(schema.stockoutIncidents.source, "auto")));
        if (!existing) {
          await db.insert(schema.stockoutIncidents).values({
            skuId: sku.id, weekStart: week, source: "auto", lostUnits: f, lostValue: f * (sku.unitPrice ?? 0),
            note: `Stock 0 with ${Math.round(f)}/wk expected${sku.priceSource === "placeholder" ? " (value uses placeholder price)" : ""}`,
          });
          incidents++;
        }
      }
    }
  }

  const poUpdates = await syncPurchaseOrderStatuses(db);
  const ks = await recordKillSwitch(db, today, opts.notify ?? true);
  return { today, week, checked, incidents, forecastSource, poUpdates, killSwitch: ks.overall, alerted: ks.alerted };
}

/** Stores today's kill-switch light; emails Deepa only when it turns red (not every day it stays red). */
async function recordKillSwitch(db: Db, today: string, notify: boolean): Promise<KillSwitch & { alerted: boolean }> {
  const ks = await computeKillSwitch(db);
  // The latest stored light, today's included, so a second run on the same day doesn't alert twice.
  const [prev] = await db.select().from(schema.killSwitchHistory).where(lte(schema.killSwitchHistory.checkDate, today))
    .orderBy(desc(schema.killSwitchHistory.checkDate)).limit(1);
  await db.insert(schema.killSwitchHistory).values({ checkDate: today, overall: ks.overall, early: ks.early.status, outcome: ks.outcome.status, detail: ks.messages })
    .onConflictDoUpdate({ target: schema.killSwitchHistory.checkDate, set: { overall: ks.overall, early: ks.early.status, outcome: ks.outcome.status, detail: ks.messages } });
  const alerted = notify && ks.overall === "red" && prev?.overall !== "red";
  if (alerted) await notifyKillSwitchRed(db, ks);
  return { ...ks, alerted };
}
