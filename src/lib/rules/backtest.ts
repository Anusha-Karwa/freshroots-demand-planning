import type { RulesConfig } from "@/lib/config/rules";
import { addDays, monthOfWeek } from "@/lib/seed/parse";
import { evaluateSku, ruleFlags } from "./engine";
import { seriesUpTo, type SalesHistory, type SkuInfo } from "./data";

/**
 * Replays the rules at past cutoff weeks and compares them with what actually happened next.
 * No Raghav history is needed: the outcome is the realised sales (and stock, when snapshots exist).
 *
 * - High demand: at each cutoff, did the next `horizonWeeks` average stay > threshold above the
 *   12-week baseline? Agreement = flags that matched what happened, on rule-covered SKUs (exceptions excluded).
 * - Forecast: fresh (twice-weekly, data to the cutoff) vs stale (monthly cycle, data `staleLagWeeks` older),
 *   both against actual units over the horizon.
 * - ₹ impact (simulated): if stock were planned to the forecast, under-forecast units are lost sales
 *   (× unit price) and over-forecast units are excess stock (× unit cost).
 * - Stock flags: replayed only at cutoffs that have a stock snapshot dated the following Monday (±3 days).
 */

export interface BacktestOptions {
  horizonWeeks: number;
  staleLagWeeks: number;
}

export const DEFAULT_BACKTEST: BacktestOptions = { horizonWeeks: 4, staleLagWeeks: 4 };

export interface BacktestRow {
  cutoff: string; // last week of data the rules saw
  skuId: string;
  planningMonth: number;
  exception: boolean; // would have gone to Raghav's queue instead
  outcomeWeeks: number;
  avg12: number;
  actualAvg: number;
  predictedHigh: boolean;
  actualHigh: boolean;
  freshForecast: number; // weekly
  staleForecast: number | null; // weekly; null when not enough history at the stale cutoff
  stock?: { onHand: number; predicted: string[]; actual: string[] };
  fresh: { under: number; over: number; lostSales: number | null; excess: number | null };
  stale: { under: number; over: number; lostSales: number | null; excess: number | null } | null;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  n: number;
  agreementPct: number | null;
  precisionPct: number | null;
  recallPct: number | null;
}

export interface BacktestResult {
  options: BacktestOptions;
  weeks: { first: string; last: string; count: number };
  cutoffs: string[];
  rows: BacktestRow[];
  highDemand: Confusion;
  stockFlags: { available: boolean; stockout: Confusion; overstock: Confusion; cutoffsWithStock: string[] };
  forecast: {
    n: number; // rows with both fresh and stale forecasts (like-for-like)
    freshWapePct: number | null;
    staleWapePct: number | null;
    fresh: { lostSales: number; excess: number };
    stale: { lostSales: number; excess: number };
    savings: number; // (stale − fresh) lost sales + excess, ₹ over the replayed period
    pricedRows: number;
    placeholderPrices: boolean;
  };
  raghav: { available: false; targetPct: number };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : null);

function confusion(pairs: { p: boolean; a: boolean }[]): Confusion {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const { p, a } of pairs) c[p ? (a ? "tp" : "fp") : a ? "fn" : "tn"]++;
  const n = pairs.length;
  return {
    ...c, n,
    agreementPct: pct(c.tp + c.tn, n),
    precisionPct: pct(c.tp, c.tp + c.fp),
    recallPct: pct(c.tp, c.tp + c.fn),
  };
}

function money(under: number, over: number, sku: SkuInfo) {
  return {
    under, over,
    lostSales: sku.unitPrice != null ? under * sku.unitPrice : null,
    excess: sku.unitCost != null ? over * sku.unitCost : null,
  };
}

/** Find a stock snapshot taken the Monday after `cutoff` (±3 days). */
function stockAt(snapshots: Map<string, Map<string, number>>, cutoff: string) {
  const target = addDays(cutoff, 7);
  for (let d = -3; d <= 3; d++) {
    const s = snapshots.get(addDays(target, d));
    if (s) return s;
  }
  return null;
}

export function runBacktest(
  history: SalesHistory,
  skus: SkuInfo[],
  config: RulesConfig,
  stockSnapshots: Map<string, Map<string, number>> = new Map(),
  options: BacktestOptions = DEFAULT_BACKTEST,
): BacktestResult {
  const { weeks } = history;
  const base = config.highDemand.baselineWeeks;
  const rows: BacktestRow[] = [];
  const cutoffs: string[] = [];
  const cutoffsWithStock: string[] = [];

  // A cutoff needs a full baseline window before it and at least one week of outcome after it.
  for (let c = base - 1; c <= weeks.length - 2; c++) {
    const cutoff = weeks[c];
    cutoffs.push(cutoff);
    const planningMonth = Number(monthOfWeek(addDays(cutoff, 7)).slice(5, 7));
    const uplift = config.festival.months.includes(planningMonth) ? config.festival.upliftMultiplier : 1;
    const stock = stockAt(stockSnapshots, cutoff);
    if (stock) cutoffsWithStock.push(cutoff);

    for (const sku of skus) {
      const series = history.bySku.get(sku.skuId);
      if (!series) continue;
      const past = seriesUpTo(series, c);
      if (past.length < base) continue; // new SKU at this cutoff — Raghav's call, not the rules'
      const future = series.slice(c + 1, c + 1 + options.horizonWeeks).filter((x): x is number => x !== null);
      if (!future.length) continue;

      const onHand = stock?.get(sku.skuId);
      const input = {
        skuId: sku.skuId, isPerishable: sku.isPerishable, standardOrderQty: sku.standardOrderQty,
        weeklyUnits: past, stockOnHand: onHand ?? 0,
      };
      const ev = evaluateSku(input, config, planningMonth);
      const avg12 = mean(past.slice(-base));
      const actualAvg = mean(future);
      const actualTotal = future.reduce((a, b) => a + b, 0);

      const freshForecast = avg12 * uplift;
      const freshTotal = freshForecast * future.length;

      // The monthly process: Raghav's forecast built on data `staleLagWeeks` older than the cutoff.
      const stalePast = seriesUpTo(series, c - options.staleLagWeeks);
      const staleForecast = stalePast.length >= config.highDemand.recentWeeks ? mean(stalePast.slice(-base)) * uplift : null;
      const staleTotal = staleForecast === null ? null : staleForecast * future.length;

      let stockCheck: BacktestRow["stock"];
      if (onHand !== undefined) {
        const predicted = ruleFlags(input, config, planningMonth).filter((f) => f !== "HIGH_DEMAND");
        const w = sku.isPerishable ? config.cover.perishable : config.cover.standard;
        // What actually happened: cover measured against realised demand (no receipts assumed).
        const actualCover = actualAvg > 0 ? onHand / actualAvg : Infinity;
        const actual = [
          ...(actualCover < w.minWeeks ? ["STOCKOUT_RISK"] : []),
          ...(actualCover > w.maxWeeks ? ["OVERSTOCK_RISK"] : []),
        ];
        stockCheck = { onHand, predicted, actual };
      }

      rows.push({
        cutoff, skuId: sku.skuId, planningMonth,
        exception: ev.kind === "exception",
        outcomeWeeks: future.length,
        avg12, actualAvg,
        predictedHigh: ruleFlags(input, config, planningMonth).includes("HIGH_DEMAND"),
        actualHigh: avg12 > 0 && actualAvg > avg12 * (1 + config.highDemand.thresholdPct / 100),
        freshForecast,
        staleForecast,
        stock: stockCheck,
        fresh: money(Math.max(0, actualTotal - freshTotal), Math.max(0, freshTotal - actualTotal), sku),
        stale: staleTotal === null ? null : money(Math.max(0, actualTotal - staleTotal), Math.max(0, staleTotal - actualTotal), sku),
      });
    }
  }

  const covered = rows.filter((r) => !r.exception);
  const withStock = covered.filter((r) => r.stock);
  const both = rows.filter((r) => r.stale);
  const actualUnits = (r: BacktestRow) => r.actualAvg * r.outcomeWeeks;
  const wape = (err: (r: BacktestRow) => number) => {
    const den = both.reduce((a, r) => a + actualUnits(r), 0);
    return den ? Math.round((both.reduce((a, r) => a + err(r), 0) / den) * 1000) / 10 : null;
  };
  const sum = (f: (r: BacktestRow) => number | null) => both.reduce((a, r) => a + (f(r) ?? 0), 0);
  const fresh = { lostSales: sum((r) => r.fresh.lostSales), excess: sum((r) => r.fresh.excess) };
  const stale = { lostSales: sum((r) => r.stale!.lostSales), excess: sum((r) => r.stale!.excess) };
  const skuById = new Map(skus.map((s) => [s.skuId, s]));

  return {
    options,
    weeks: { first: weeks[0], last: weeks.at(-1)!, count: weeks.length },
    cutoffs,
    rows,
    highDemand: confusion(covered.map((r) => ({ p: r.predictedHigh, a: r.actualHigh }))),
    stockFlags: {
      available: withStock.length > 0,
      stockout: confusion(withStock.map((r) => ({ p: r.stock!.predicted.includes("STOCKOUT_RISK"), a: r.stock!.actual.includes("STOCKOUT_RISK") }))),
      overstock: confusion(withStock.map((r) => ({ p: r.stock!.predicted.includes("OVERSTOCK_RISK"), a: r.stock!.actual.includes("OVERSTOCK_RISK") }))),
      cutoffsWithStock,
    },
    forecast: {
      n: both.length,
      freshWapePct: wape((r) => r.fresh.under + r.fresh.over),
      staleWapePct: wape((r) => r.stale!.under + r.stale!.over),
      fresh,
      stale,
      savings: stale.lostSales + stale.excess - (fresh.lostSales + fresh.excess),
      pricedRows: both.filter((r) => r.fresh.lostSales !== null).length,
      placeholderPrices: both.some((r) => skuById.get(r.skuId)?.priceSource === "placeholder"),
    },
    raghav: { available: false, targetPct: 85 },
  };
}
