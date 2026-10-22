import type { RulesConfig } from "@/lib/config/rules";

/**
 * Raghav's forecasting rules. Pure functions, no AI, no database: same inputs → same output.
 *
 * Order of evaluation (per SKU):
 *   1. Exceptions (new SKU, distributor concentration, week-on-week swing) → judgement queue, no quantity.
 *   2. Festival uplift on expected demand.
 *   3. HIGH_DEMAND, STOCKOUT_RISK, OVERSTOCK_RISK flags and the recommended quantity.
 */

export type Flag = "HIGH_DEMAND" | "STOCKOUT_RISK" | "OVERSTOCK_RISK";
export type Action = "REORDER" | "REORDER_NOW" | "PAUSE_NEXT_ORDER";
export type ExceptionType = "NEW_SKU" | "DISTRIBUTOR_CONCENTRATION" | "WOW_SWING" | "CONFLICTING_FLAGS";

export interface SkuInput {
  skuId: string;
  isPerishable: boolean;
  standardOrderQty: number;
  /** Weekly units, oldest → newest, one entry per week up to the last complete week (no gaps). */
  weeklyUnits: number[];
  stockOnHand: number;
  /** Per-distributor units for the last two weeks; omit when sales are SKU-level only. */
  distributorLastTwoWeeks?: { previous: Record<string, number>; current: Record<string, number> };
}

export interface Metrics {
  weeksOfHistory: number;
  avg4: number; // average weekly units, last `recentWeeks` weeks
  avg12: number; // average weekly units, last `baselineWeeks` weeks (fewer if history is shorter)
  pct4v12: number | null; // % by which avg4 exceeds avg12; null when avg12 = 0
  festival: boolean;
  uplift: number; // 1 or the festival multiplier
  expectedWeekly: number; // avg12 × uplift — the demand cover is measured against
  stockOnHand: number;
  weeksOfCover: number | null; // stock ÷ expectedWeekly; null when expected demand is 0
  coverWindow: { minWeeks: number; maxWeeks: number; perishable: boolean };
  lastWeekUnits: number;
  prevWeekUnits: number | null;
  wowPct: number | null; // week-on-week change %, null when the previous week was 0 (or missing)
  topDistributor?: { id: string; sharePct: number } | null; // biggest single share of the WoW change
  standardOrderQty: number;
}

export type Evaluation =
  | { kind: "ok"; skuId: string; metrics: Metrics }
  | { kind: "flag"; skuId: string; flags: Flag[]; primaryFlag: Flag; action: Action; recommendedQty: number; metrics: Metrics }
  | { kind: "exception"; skuId: string; types: ExceptionType[]; ruleFlags: Flag[]; metrics: Metrics };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

// Threshold comparisons that ignore floating-point noise, so "exactly 20%" or "exactly 6 weeks" never flags
// (e.g. 1000/12 × 1.2 evaluates to 99.99999999999999, not 100).
const EPS = 1e-9;
const gt = (a: number, b: number) => a - b > EPS * Math.max(1, Math.abs(b));
const lt = (a: number, b: number) => b - a > EPS * Math.max(1, Math.abs(b));

/** Share of the week-on-week change driven by the single biggest distributor moving the same way. */
export function distributorConcentration(previous: Record<string, number>, current: Record<string, number>) {
  const ids = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const deltas = [...ids].map((id) => ({ id, delta: (current[id] ?? 0) - (previous[id] ?? 0) }));
  const total = deltas.reduce((a, d) => a + d.delta, 0);
  if (total === 0) return null;
  const top = deltas.reduce((best, d) => (d.delta / total > best.delta / total ? d : best));
  return { id: top.id, sharePct: round2((top.delta / total) * 100) };
}

export function computeMetrics(sku: SkuInput, config: RulesConfig, planningMonth: number): Metrics {
  const u = sku.weeklyUnits;
  const avg4 = mean(u.slice(-config.highDemand.recentWeeks));
  const avg12 = mean(u.slice(-config.highDemand.baselineWeeks));
  const festival = config.festival.months.includes(planningMonth);
  const uplift = festival ? config.festival.upliftMultiplier : 1;
  const expectedWeekly = avg12 * uplift;
  const window = sku.isPerishable ? config.cover.perishable : config.cover.standard;
  const last = u.at(-1) ?? 0;
  const prev = u.length >= 2 ? u[u.length - 2] : null;
  return {
    weeksOfHistory: u.length,
    avg4: round2(avg4),
    avg12: round2(avg12),
    pct4v12: avg12 > 0 ? round2((avg4 / avg12 - 1) * 100) : null,
    festival,
    uplift,
    expectedWeekly: round2(expectedWeekly),
    stockOnHand: sku.stockOnHand,
    weeksOfCover: expectedWeekly > 0 ? round2(sku.stockOnHand / expectedWeekly) : null,
    coverWindow: { ...window, perishable: sku.isPerishable },
    lastWeekUnits: last,
    prevWeekUnits: prev,
    wowPct: prev ? round2((last / prev - 1) * 100) : null,
    topDistributor: sku.distributorLastTwoWeeks
      ? distributorConcentration(sku.distributorLastTwoWeeks.previous, sku.distributorLastTwoWeeks.current)
      : undefined,
    standardOrderQty: sku.standardOrderQty,
  };
}

/** The three threshold rules, computed from raw (unrounded) inputs so exact edges behave exactly. */
export function ruleFlags(sku: SkuInput, config: RulesConfig, planningMonth: number): Flag[] {
  const u = sku.weeklyUnits;
  const avg4 = mean(u.slice(-config.highDemand.recentWeeks));
  const avg12 = mean(u.slice(-config.highDemand.baselineWeeks));
  const uplift = config.festival.months.includes(planningMonth) ? config.festival.upliftMultiplier : 1;
  const expected = avg12 * uplift;
  const window = sku.isPerishable ? config.cover.perishable : config.cover.standard;
  const flags: Flag[] = [];

  // Rule 2: last-4-week sales more than X% above the 12-week weekly average.
  if (avg12 > 0 && gt(avg4, avg12 * (1 + config.highDemand.thresholdPct / 100))) flags.push("HIGH_DEMAND");

  // Rules 3–5: stock below min / above max weeks of (uplifted) expected demand.
  if (expected > 0) {
    if (lt(sku.stockOnHand, window.minWeeks * expected)) flags.push("STOCKOUT_RISK");
    if (gt(sku.stockOnHand, window.maxWeeks * expected)) flags.push("OVERSTOCK_RISK");
  } else if (sku.stockOnHand > 0) {
    // No sales at all but stock on hand: any stock exceeds 14 (or 4) weeks of zero demand.
    flags.push("OVERSTOCK_RISK");
  }
  return flags;
}

export function exceptionTypes(sku: SkuInput, config: RulesConfig, metrics: Metrics, flags: Flag[]): ExceptionType[] {
  const types: ExceptionType[] = [];
  const ex = config.exceptions;
  if (metrics.weeksOfHistory < ex.minHistoryWeeks) types.push("NEW_SKU");
  if (metrics.topDistributor && gt(metrics.topDistributor.sharePct, ex.distributorConcentrationPct)) types.push("DISTRIBUTOR_CONCENTRATION");
  const { lastWeekUnits: last, prevWeekUnits: prev } = metrics;
  if (prev !== null && (prev === 0 ? last > 0 : gt(Math.abs(last / prev - 1) * 100, ex.wowSwingPct))) types.push("WOW_SWING");
  // Demand rising while stock is already too high: the rules disagree with each other.
  if (flags.includes("HIGH_DEMAND") && flags.includes("OVERSTOCK_RISK")) types.push("CONFLICTING_FLAGS");
  return types;
}

const PRIORITY: Flag[] = ["STOCKOUT_RISK", "HIGH_DEMAND", "OVERSTOCK_RISK"];

/** Recommended quantity and action for a set of flags. Quantities come only from here. */
export function recommend(flags: Flag[], standardOrderQty: number, config: RulesConfig): { action: Action; qty: number } {
  if (flags.includes("OVERSTOCK_RISK")) return { action: "PAUSE_NEXT_ORDER", qty: 0 };
  const qty = flags.includes("HIGH_DEMAND")
    ? Math.round(standardOrderQty * config.highDemand.orderMultiplier)
    : standardOrderQty;
  return { action: flags.includes("STOCKOUT_RISK") ? "REORDER_NOW" : "REORDER", qty };
}

/**
 * Evaluate one SKU. `planningMonth` (1–12) is the month of the week being planned for — the festival
 * uplift applies when it is a festival month.
 */
export function evaluateSku(sku: SkuInput, config: RulesConfig, planningMonth: number): Evaluation {
  const metrics = computeMetrics(sku, config, planningMonth);
  const flags = ruleFlags(sku, config, planningMonth);
  const types = exceptionTypes(sku, config, metrics, flags);
  if (types.length) return { kind: "exception", skuId: sku.skuId, types, ruleFlags: flags, metrics };
  if (!flags.length) return { kind: "ok", skuId: sku.skuId, metrics };
  const { action, qty } = recommend(flags, sku.standardOrderQty, config);
  const primaryFlag = PRIORITY.find((f) => flags.includes(f))!;
  return { kind: "flag", skuId: sku.skuId, flags, primaryFlag, action, recommendedQty: qty, metrics };
}
