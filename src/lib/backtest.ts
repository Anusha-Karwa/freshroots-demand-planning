import { schema, type Db } from "@/db";
import { addDays } from "@/lib/dates";
import { loadEngineData, type SkuInfo } from "@/lib/forecast/inputs";
import { evaluateSku, type SkuInput } from "@/lib/rules/engine";
import type { RulesConfig } from "@/lib/rules/config";
import { getRules } from "@/lib/settings";

/**
 * Replays the rules on history, one as-of week at a time, and checks them against what actually happened.
 *  1. High-demand flags: did demand in the following weeks really stay > 20% above the 12-week average?
 *  2. Forecast freshness: the twice-weekly cycle (data through last week) vs the monthly cycle (data 4 weeks
 *     older), valued in ₹ — under-forecast units at price (lost-sales risk), over-forecast at cost (overstock risk).
 *  3. Agreement with Raghav's past flags, when his history is loaded (target ≥ 85% on rule-covered SKUs).
 * Stock-cover flags are only replayed for weeks with a stock snapshot (one snapshot is loaded today).
 */

export interface BacktestPoint {
  skuId: string; asOfWeek: string; flagged: boolean; demandStayedHigh: boolean;
  actual: number; freshForecast: number; monthlyForecast: number;
}

export interface BacktestResult {
  weeksReplayed: string[];
  points: number;
  highDemand: { flagged: number; confirmed: number; missed: number; accuracyPct: number | null; precisionPct: number | null };
  forecast: { freshMapePct: number | null; monthlyMapePct: number | null; freshCost: number; monthlyCost: number; savings: number; savingsPerMonth: number };
  agreement: { compared: number; agreed: number; pct: number | null; byFlag: Record<string, { agreed: number; total: number }> } | null;
  perSku: { skuId: string; name: string; flaggedWeeks: number; confirmedWeeks: number; freshErr: number; monthlyErr: number }[];
  placeholderPrices: boolean;
  monthlyLagWeeks: number;
}

const FUTURE_WEEKS = 4;
const MONTHLY_LAG = 4; // monthly cycle: data 3–4 weeks old when procurement acts

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Pure core: replays one SKU. weeks[i] is the Monday of weekly[i]. */
export function replaySku(input: SkuInput, weeks: string[], cfg: RulesConfig): BacktestPoint[] {
  const out: BacktestPoint[] = [];
  const w = input.weekly;
  for (let t = cfg.longWindowWeeks; t < w.length; t++) {
    const planning = weeks[t];
    const hist = { ...input, weekly: w.slice(0, t), stock: null, lastWeekByDistributor: undefined, prevWeekByDistributor: undefined };
    const e = evaluateSku(hist, cfg, planning);
    if (e.exceptions.some((x) => x !== "NO_STOCK_DATA")) continue; // judgement cases aren't rule-covered
    const future = w.slice(t, t + FUTURE_WEEKS);
    const threshold = e.metrics.avgLong * (1 + cfg.highDemandPct / 100);
    const monthlyHist = w.slice(0, Math.max(1, t - MONTHLY_LAG));
    const monthly = evaluateSku({ ...hist, weekly: monthlyHist }, cfg, planning).metrics.expectedWeekly;
    out.push({
      skuId: input.skuId,
      asOfWeek: planning,
      flagged: e.flags.includes("HIGH_DEMAND"),
      demandStayedHigh: e.metrics.avgLong > 0 && mean(future) > threshold,
      actual: w[t],
      freshForecast: e.metrics.expectedWeekly,
      monthlyForecast: monthly,
    });
  }
  return out;
}

export async function runBacktest(db: Db): Promise<BacktestResult> {
  const rules = await getRules(db);
  const data = await loadEngineData(db);
  const points: BacktestPoint[] = [];
  const perSku: BacktestResult["perSku"] = [];
  const cost = (sku: SkuInfo | undefined, p: BacktestPoint, f: number) =>
    f < p.actual ? (p.actual - f) * (sku?.unitPrice ?? 0) : (f - p.actual) * (sku?.unitCost ?? 0);

  let freshCost = 0, monthlyCost = 0;
  const ape = { fresh: [] as number[], monthly: [] as number[] };
  for (const input of data.inputs) {
    if (!data.lastWeek || !input.weekly.length) continue;
    const first = addDays(data.lastWeek, -7 * (input.weekly.length - 1));
    const weeks = input.weekly.map((_, i) => addDays(first, 7 * i));
    const pts = replaySku(input, weeks, rules.config);
    const sku = data.skus.get(input.skuId);
    let fe = 0, me = 0;
    for (const p of pts) {
      freshCost += cost(sku, p, p.freshForecast);
      monthlyCost += cost(sku, p, p.monthlyForecast);
      fe += Math.abs(p.freshForecast - p.actual);
      me += Math.abs(p.monthlyForecast - p.actual);
      if (p.actual > 0) {
        ape.fresh.push(Math.abs(p.freshForecast - p.actual) / p.actual);
        ape.monthly.push(Math.abs(p.monthlyForecast - p.actual) / p.actual);
      }
    }
    points.push(...pts);
    if (pts.length) perSku.push({
      skuId: input.skuId, name: sku?.name ?? input.skuId,
      flaggedWeeks: pts.filter((p) => p.flagged).length, confirmedWeeks: pts.filter((p) => p.flagged && p.demandStayedHigh).length,
      freshErr: fe / pts.length, monthlyErr: me / pts.length,
    });
  }

  const flagged = points.filter((p) => p.flagged);
  const confirmed = flagged.filter((p) => p.demandStayedHigh).length;
  const missed = points.filter((p) => !p.flagged && p.demandStayedHigh).length;
  const correct = points.filter((p) => p.flagged === p.demandStayedHigh).length;
  const weeksReplayed = [...new Set(points.map((p) => p.asOfWeek))].sort();
  const savings = monthlyCost - freshCost;

  return {
    weeksReplayed,
    points: points.length,
    highDemand: {
      flagged: flagged.length, confirmed, missed,
      accuracyPct: points.length ? (correct / points.length) * 100 : null,
      precisionPct: flagged.length ? (confirmed / flagged.length) * 100 : null,
    },
    forecast: {
      freshMapePct: ape.fresh.length ? mean(ape.fresh) * 100 : null,
      monthlyMapePct: ape.monthly.length ? mean(ape.monthly) * 100 : null,
      freshCost, monthlyCost, savings,
      savingsPerMonth: weeksReplayed.length ? (savings / weeksReplayed.length) * (52 / 12) : 0,
    },
    agreement: await plannerAgreement(db, data, rules.config),
    perSku: perSku.sort((a, b) => b.monthlyErr - b.freshErr - (a.monthlyErr - a.freshErr)),
    placeholderPrices: [...data.skus.values()].some((s) => s.priceSource === "placeholder"),
    monthlyLagWeeks: MONTHLY_LAG,
  };
}

/** Compares the rules with Raghav's own past flags (planner_history), on SKU-weeks the rules cover. */
async function plannerAgreement(db: Db, data: Awaited<ReturnType<typeof loadEngineData>>, cfg: RulesConfig) {
  const history = await db.select().from(schema.plannerHistory);
  if (!history.length || !data.lastWeek) return null;
  const snapshots = await db.select().from(schema.stockSnapshots);
  const stockNear = (sku: string, week: string) => {
    const s = snapshots.filter((x) => x.skuId === sku && x.asOf >= addDays(week, -7) && x.asOf <= week);
    return s.length ? s.reduce((a, b) => a + b.units, 0) : null;
  };
  const byKey = new Map<string, Set<string>>();
  for (const h of history) (byKey.get(`${h.skuId}|${h.weekStart}`) ?? byKey.set(`${h.skuId}|${h.weekStart}`, new Set()).get(`${h.skuId}|${h.weekStart}`)!).add(h.flag);

  let compared = 0, agreed = 0;
  const byFlag: Record<string, { agreed: number; total: number }> = {};
  for (const [key, raghav] of byKey) {
    const [skuId, week] = key.split("|");
    const input = data.inputs.find((i) => i.skuId === skuId);
    if (!input) continue;
    const idx = input.weekly.length - 1 - Math.round((new Date(data.lastWeek).getTime() - new Date(week).getTime()) / (7 * 86_400_000));
    if (idx < 1) continue;
    const stock = stockNear(skuId, week);
    const e = evaluateSku({ ...input, weekly: input.weekly.slice(0, idx), stock, lastWeekByDistributor: undefined, prevWeekByDistributor: undefined }, cfg, week);
    if (e.exceptions.some((x) => x !== "NO_STOCK_DATA")) continue;
    // Without a stock figure only the high-demand call can be compared.
    const comparable = stock == null ? ["HIGH_DEMAND"] : ["HIGH_DEMAND", "STOCKOUT_RISK", "OVERSTOCK_RISK"];
    const mine = new Set<string>(e.flags.filter((f) => comparable.includes(f)));
    const theirs = new Set([...raghav].filter((f) => comparable.includes(f)));
    const same = mine.size === theirs.size && [...mine].every((f) => theirs.has(f));
    compared++;
    if (same) agreed++;
    for (const f of comparable) {
      const b = (byFlag[f] ??= { agreed: 0, total: 0 });
      if (mine.has(f) || theirs.has(f)) { b.total++; if (mine.has(f) === theirs.has(f)) b.agreed++; }
    }
  }
  return { compared, agreed, pct: compared ? (agreed / compared) * 100 : null, byFlag };
}
