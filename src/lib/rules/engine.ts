import { monthOf } from "@/lib/dates";
import type { RulesConfig } from "./config";

/**
 * Raghav's rules, as a pure function: one SKU's history in, flags + numbers out. No database, no AI.
 * Everything a recommendation shows on screen comes from the metrics returned here.
 */

export type Flag = "HIGH_DEMAND" | "STOCKOUT_RISK" | "OVERSTOCK_RISK";
export type ExceptionCode = "NEW_SKU" | "WOW_SWING" | "DISTRIBUTOR_CONCENTRATION" | "RULES_CONFLICT" | "NO_STOCK_DATA" | "AI_UNUSUAL";
export type Action = "reorder_now" | "reorder" | "pause" | "judgement" | null;

export const FLAG_LABEL: Record<Flag, string> = {
  HIGH_DEMAND: "High demand",
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
};

export const EXCEPTION_LABEL: Record<ExceptionCode, string> = {
  NEW_SKU: "New SKU (short history)",
  WOW_SWING: "Week-on-week swing",
  DISTRIBUTOR_CONCENTRATION: "One distributor drives the change",
  RULES_CONFLICT: "Rules disagree",
  NO_STOCK_DATA: "No stock figure",
  AI_UNUSUAL: "Looks unusual (AI)",
};

export interface SkuInput {
  skuId: string;
  perishable: boolean;
  standardOrderQty: number;
  /** Weekly units, oldest → newest, one entry per week, ending with the latest complete week. */
  weekly: number[];
  /** Units by distributor for the latest and the previous week; omitted when sales are SKU-level only. */
  lastWeekByDistributor?: Record<string, number>;
  prevWeekByDistributor?: Record<string, number>;
  stock: number | null;
}

export interface ItemMetrics {
  weeksOfHistory: number;
  avgShort: number; // average of the last 4 weeks
  avgLong: number; // average of the last 12 weeks
  changePct: number | null; // avgShort vs avgLong
  festival: boolean;
  upliftFactor: number;
  expectedWeekly: number; // avgLong × festival uplift: the forecast for next week
  stock: number | null;
  weeksCover: number | null; // stock ÷ expectedWeekly; null when there is no demand or no stock figure
  minCoverWeeks: number;
  maxCoverWeeks: number;
  perishable: boolean;
  lastWeek: number | null;
  prevWeek: number | null;
  wowPct: number | null;
  topDistributor: { id: string; sharePct: number; change: number } | null;
  unitsToMinCover: number; // how far stock is below the minimum window
  standardOrderQty: number;
  ruleSuggestedQty: number | null; // what the rules alone would order (also shown on exceptions)
}

export interface Evaluation {
  skuId: string;
  flags: Flag[];
  exceptions: ExceptionCode[];
  queue: "none" | "review" | "exception";
  action: Action;
  recommendedQty: number | null;
  metrics: ItemMetrics;
}

// Rules say "more than" / "falls below" / "exceeds": strict comparisons. The tolerance stops float noise
// (1000/12 × 1.2 = 99.99999999999999) from deciding a flag that sits exactly on a threshold.
const EPS = 1e-9;
const gt = (a: number, b: number) => a - b > EPS * Math.max(1, Math.abs(b));
const lt = (a: number, b: number) => b - a > EPS * Math.max(1, Math.abs(b));

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

export function isPerishable(skuId: string, fileFlag: boolean, cfg: RulesConfig) {
  return cfg.perishableOverrides[skuId] ?? fileFlag;
}

/** Evaluates one SKU. planningDate is the date the plan is for (its month decides the festival uplift). */
export function evaluateSku(input: SkuInput, cfg: RulesConfig, planningDate: string): Evaluation {
  const perishable = isPerishable(input.skuId, input.perishable, cfg);
  const weekly = input.weekly;
  const avgShort = mean(weekly.slice(-cfg.shortWindowWeeks));
  const avgLong = mean(weekly.slice(-cfg.longWindowWeeks));
  const festival = cfg.festivalMonths.includes(monthOf(planningDate));
  const upliftFactor = festival ? 1 + cfg.festivalUpliftPct / 100 : 1;
  const expectedWeekly = Math.max(0, avgLong) * upliftFactor;
  const minCoverWeeks = perishable ? cfg.perishableMinCoverWeeks : cfg.minCoverWeeks;
  const maxCoverWeeks = perishable ? cfg.perishableMaxCoverWeeks : cfg.maxCoverWeeks;
  const stock = input.stock;
  const weeksCover = stock == null || expectedWeekly <= 0 ? null : stock / expectedWeekly;

  // ---- Flags (rules 1–5) ----
  const flags: Flag[] = [];
  if (avgLong > 0 && gt(avgShort, avgLong * (1 + cfg.highDemandPct / 100))) flags.push("HIGH_DEMAND");
  if (stock != null && expectedWeekly > 0 && lt(stock, minCoverWeeks * expectedWeekly)) flags.push("STOCKOUT_RISK");
  if (stock != null && stock > 0 && (expectedWeekly <= 0 || gt(stock, maxCoverWeeks * expectedWeekly))) flags.push("OVERSTOCK_RISK");

  // ---- Exceptions (rule 6): cases the rules can't decide go to Raghav's judgement queue ----
  const exceptions: ExceptionCode[] = [];
  if (weekly.length < cfg.newSkuMinWeeks) exceptions.push("NEW_SKU");

  const lastWeek = weekly.length ? weekly[weekly.length - 1] : null;
  const prevWeek = weekly.length > 1 ? weekly[weekly.length - 2] : null;
  let wowPct: number | null = null;
  if (lastWeek != null && prevWeek != null) {
    if (prevWeek > 0) wowPct = ((lastWeek - prevWeek) / prevWeek) * 100;
    else if (lastWeek > 0) wowPct = Infinity; // from nothing to something is always a swing
    if (wowPct != null && gt(Math.abs(wowPct), cfg.wowSwingPct)) exceptions.push("WOW_SWING");
  }

  const topDistributor = distributorConcentration(input, prevWeek, lastWeek);
  if (topDistributor && prevWeek != null && lastWeek != null) {
    const change = Math.abs(lastWeek - prevWeek);
    const bigEnough = change > 0 && !lt(change, (cfg.distributorMinChangePct / 100) * Math.abs(prevWeek));
    if (bigEnough && gt(topDistributor.sharePct, cfg.distributorSharePct)) exceptions.push("DISTRIBUTOR_CONCENTRATION");
  }

  if (flags.includes("HIGH_DEMAND") && flags.includes("OVERSTOCK_RISK")) exceptions.push("RULES_CONFLICT");
  if (stock == null) exceptions.push("NO_STOCK_DATA");

  // ---- Quantities: the rules compute, Raghav decides ----
  let action: Action = null;
  let ruleSuggestedQty: number | null = null;
  const std = input.standardOrderQty;
  if (flags.includes("OVERSTOCK_RISK")) {
    action = "pause";
    ruleSuggestedQty = 0;
  } else if (flags.includes("HIGH_DEMAND")) {
    action = flags.includes("STOCKOUT_RISK") ? "reorder_now" : "reorder";
    ruleSuggestedQty = round(std * cfg.highDemandOrderMultiplier, 0);
  } else if (flags.includes("STOCKOUT_RISK")) {
    action = "reorder_now";
    ruleSuggestedQty = std;
  }

  const queue = exceptions.length ? "exception" : flags.length ? "review" : "none";
  const metrics: ItemMetrics = {
    weeksOfHistory: weekly.length,
    avgShort: round(avgShort),
    avgLong: round(avgLong),
    changePct: avgLong > 0 ? round((avgShort / avgLong - 1) * 100, 1) : null,
    festival,
    upliftFactor,
    expectedWeekly: round(expectedWeekly),
    stock,
    weeksCover: weeksCover == null ? null : round(weeksCover, 1),
    minCoverWeeks,
    maxCoverWeeks,
    perishable,
    lastWeek,
    prevWeek,
    wowPct: wowPct == null ? null : Number.isFinite(wowPct) ? round(wowPct, 1) : null,
    topDistributor,
    unitsToMinCover: stock == null ? 0 : Math.max(0, Math.ceil(minCoverWeeks * expectedWeekly - stock)),
    standardOrderQty: std,
    ruleSuggestedQty,
  };

  return {
    skuId: input.skuId,
    flags,
    exceptions,
    queue,
    action: queue === "exception" ? "judgement" : action,
    recommendedQty: queue === "review" ? ruleSuggestedQty : null,
    metrics,
  };
}

/** The distributor whose own week-on-week change is the largest share of the SKU's total change. */
function distributorConcentration(input: SkuInput, prevWeek: number | null, lastWeek: number | null) {
  const last = input.lastWeekByDistributor;
  const prev = input.prevWeekByDistributor;
  if (!last || !prev || prevWeek == null || lastWeek == null) return null;
  const total = lastWeek - prevWeek;
  if (total === 0) return null;
  let best: { id: string; sharePct: number; change: number } | null = null;
  for (const id of new Set([...Object.keys(last), ...Object.keys(prev)])) {
    const change = (last[id] ?? 0) - (prev[id] ?? 0);
    const sharePct = (Math.abs(change) / Math.abs(total)) * 100;
    if (!best || sharePct > best.sharePct) best = { id, sharePct: round(sharePct, 1), change };
  }
  return best;
}
