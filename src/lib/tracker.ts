import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getActiveRules } from "@/lib/settings";
import { computeMetrics } from "@/lib/rules/engine";
import { loadHistory, loadSkus, loadStock, seriesUpTo } from "@/lib/rules/data";
import { monthOfWeek } from "@/lib/seed/parse";
import type { MonthLoss, RunDecisions } from "@/lib/killswitch";

/** A SKU selling this far off its forecast shows up as an early warning. */
export const TRACKER_ALERT_PCT = 25;

export const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Daily early warning: for the latest sales week, actual units vs the forecast the rules made for that week.
 * Uses the forecast a run saved for that week; if no run planned it (e.g. seed history), re-runs the rules on
 * the history before it. Also records a stockout incident when a selling SKU's stock is 0.
 */
export async function updateTracker(date = todayIST()) {
  const db = await getDb();
  const { config } = await getActiveRules();
  const [history, skus, stock] = await Promise.all([loadHistory(db), loadSkus(db, config), loadStock(db)]);
  const last = history.weeks.length - 1;
  if (last < 1) return { date, week: null, rows: 0, alerts: 0, incidents: 0 };
  const week = history.weeks[last];
  const planningMonth = Number(monthOfWeek(week).slice(5, 7));

  const saved = await db
    .select()
    .from(schema.runForecasts)
    .where(eq(schema.runForecasts.planningWeek, week))
    .orderBy(desc(schema.runForecasts.runId));
  const fromRun = new Map<string, number>();
  for (const f of saved) if (!fromRun.has(f.skuId)) fromRun.set(f.skuId, f.expectedWeekly);

  const rows: (typeof schema.dailyTracker.$inferInsert)[] = [];
  const incidents: (typeof schema.stockoutIncidents.$inferInsert)[] = [];
  for (const sku of skus) {
    const series = history.bySku.get(sku.skuId);
    const actual = series?.[last];
    if (series == null || actual == null) continue;
    let forecast = fromRun.get(sku.skuId);
    let source = "run";
    if (forecast === undefined) {
      const past = seriesUpTo(series, last - 1);
      if (!past.length) continue;
      const m = computeMetrics({ skuId: sku.skuId, isPerishable: sku.isPerishable, standardOrderQty: sku.standardOrderQty, weeklyUnits: past, stockOnHand: 0 }, config, planningMonth);
      forecast = m.expectedWeekly;
      source = "replayed";
    }
    const onHand = stock.bySku.get(sku.skuId) ?? null;
    rows.push({
      date, skuId: sku.skuId, week, forecastSource: source,
      forecastUnits: forecast, actualUnits: actual, stockOnHand: onHand,
      deviationPct: forecast > 0 ? Math.round((actual / forecast - 1) * 1000) / 10 : null,
    });
    if (onHand === 0 && actual > 0 && stock.date) {
      // Out of stock while still selling: about a week of demand is at risk until the reorder lands.
      incidents.push({
        date: stock.date, skuId: sku.skuId, source: "detected", estLostUnits: Math.round(forecast),
        estLostValue: sku.unitPrice != null ? Math.round(forecast * sku.unitPrice) : null,
        note: `Stock 0 on ${stock.date}; estimate = one week of forecast demand${sku.priceSource === "placeholder" ? " (placeholder price)" : ""}.`,
      });
    }
  }

  await db.delete(schema.dailyTracker).where(eq(schema.dailyTracker.date, date));
  if (rows.length) await db.insert(schema.dailyTracker).values(rows);
  let newIncidents = 0;
  for (const inc of incidents) {
    const [exists] = await db
      .select({ id: schema.stockoutIncidents.id })
      .from(schema.stockoutIncidents)
      .where(and(eq(schema.stockoutIncidents.date, inc.date), eq(schema.stockoutIncidents.skuId, inc.skuId), eq(schema.stockoutIncidents.source, "detected")));
    if (!exists) {
      await db.insert(schema.stockoutIncidents).values(inc);
      newIncidents++;
    }
  }
  const alerts = rows.filter((r) => r.deviationPct != null && Math.abs(r.deviationPct) > TRACKER_ALERT_PCT).length;
  return { date, week, rows: rows.length, alerts, incidents: newIncidents };
}

// ---------------------------------------------------------------------------
// Reads for the tracker page and the kill switch
// ---------------------------------------------------------------------------

export async function latestTracker() {
  const db = await getDb();
  const [d] = await db.select({ d: sql<string | null>`max(${schema.dailyTracker.date})::text` }).from(schema.dailyTracker);
  if (!d.d) return { date: null, rows: [] };
  const rows = await db
    .select({ t: schema.dailyTracker, name: schema.skus.name })
    .from(schema.dailyTracker)
    .leftJoin(schema.skus, eq(schema.skus.skuId, schema.dailyTracker.skuId))
    .where(eq(schema.dailyTracker.date, d.d))
    .orderBy(sql`abs(coalesce(${schema.dailyTracker.deviationPct}, 0)) desc`);
  return { date: d.d, rows: rows.map((r) => ({ ...r.t, name: r.name })) };
}

/** Decided / overridden counts per run, newest first — the early kill switch input. */
export async function decisionsByRun(): Promise<RunDecisions[]> {
  const db = await getDb();
  const rows = (
    await db.execute<{ run_id: number; decided: number; overridden: number }>(sql`
      select run_id,
             count(*) filter (where status <> 'pending')::int as decided,
             count(*) filter (where status in ('edited', 'rejected'))::int as overridden
      from recommendations group by run_id order by run_id desc`)
  ).rows;
  return rows.map((r) => ({ runId: r.run_id, decided: r.decided, overridden: r.overridden }));
}

export async function monthlyLossRows() {
  const db = await getDb();
  return db.select().from(schema.monthlyLosses).orderBy(schema.monthlyLosses.month);
}

export const toMonthLoss = (rows: Awaited<ReturnType<typeof monthlyLossRows>>): MonthLoss[] =>
  rows.map((r) => ({ month: r.month, total: r.stockoutLoss + r.overstockWriteoff }));

/** Every edit / reject with its reason, and how old the data was when Raghav decided. */
export async function overrideLog(limit = 50) {
  const db = await getDb();
  const rows = await db
    .select({ rec: schema.recommendations, run: schema.forecastRuns })
    .from(schema.recommendations)
    .innerJoin(schema.forecastRuns, eq(schema.forecastRuns.id, schema.recommendations.runId))
    .where(inArray(schema.recommendations.status, ["edited", "rejected"]))
    .orderBy(desc(schema.recommendations.decidedAt))
    .limit(limit);
  return rows.map(({ rec, run }) => ({ ...rec, dataAsOf: run.dataAsOf, dataAgeDays: dataAgeAt(run.dataAsOf, rec.decidedAt) }));
}

/** Days between the end of the data and the decision. */
export const dataAgeAt = (dataAsOf: string | null, at: Date | null) =>
  dataAsOf && at ? Math.floor((at.getTime() - Date.parse(`${dataAsOf}T23:59:59+05:30`)) / 86_400_000) + 1 : null;

export async function decisionDataAge() {
  const db = await getDb();
  const rows = await db
    .select({ at: schema.recommendations.decidedAt, asOf: schema.forecastRuns.dataAsOf })
    .from(schema.recommendations)
    .innerJoin(schema.forecastRuns, eq(schema.forecastRuns.id, schema.recommendations.runId))
    .where(sql`${schema.recommendations.decidedAt} is not null`);
  const ages = rows.map((r) => dataAgeAt(r.asOf, r.at)).filter((x): x is number => x !== null);
  return { n: ages.length, avg: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null, max: ages.length ? Math.max(...ages) : null };
}

export async function incidents(limit = 30) {
  const db = await getDb();
  return db.select().from(schema.stockoutIncidents).orderBy(desc(schema.stockoutIncidents.date), desc(schema.stockoutIncidents.id)).limit(limit);
}

export async function stockoutFrequency() {
  const db = await getDb();
  return (
    await db.execute<{ sku_id: string; n: number }>(sql`select sku_id, count(*)::int as n from stockout_incidents group by sku_id order by n desc, sku_id limit 10`)
  ).rows;
}

export async function complaints(limit = 30) {
  const db = await getDb();
  return db.select().from(schema.distributorComplaints).orderBy(desc(schema.distributorComplaints.date), desc(schema.distributorComplaints.id)).limit(limit);
}
