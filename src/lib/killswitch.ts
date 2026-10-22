import { monthlyLossBand, type Baseline } from "@/lib/config/baseline";

/**
 * Pre-build decision #5 — kill criteria.
 *  Early:   Raghav edits or rejects > 50% of decided recommendations over the last 4 runs → red, "halt and re-evaluate rules".
 *  Outcome: monthly losses above ₹11 L for 2 consecutive months → red, "stop, run RCA, fix, redeploy".
 * Amber is the warning band before red; grey means not enough data yet.
 */

export type Status = "green" | "amber" | "red" | "grey";

export interface RunDecisions {
  runId: number;
  decided: number; // approved + edited + rejected
  overridden: number; // edited + rejected
}

export interface MonthLoss {
  month: string; // YYYY-MM
  total: number; // stockout loss + overstock write-off, ₹
}

const RANK: Record<Status, number> = { grey: 0, green: 1, amber: 2, red: 3 };
export const worst = (...s: Status[]) => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "grey" as Status);

export function earlyKill(runs: RunDecisions[], b: Baseline) {
  const ks = b.killSwitch;
  const counted = runs.filter((r) => r.decided > 0).slice(0, ks.overrideLookbackRuns); // newest first
  const decided = counted.reduce((a, r) => a + r.decided, 0);
  const overridden = counted.reduce((a, r) => a + r.overridden, 0);
  const ratePct = decided ? Math.round((overridden / decided) * 1000) / 10 : null;
  const amberAt = ks.overrideRatePct * 0.7;
  const status: Status = ratePct === null ? "grey" : ratePct > ks.overrideRatePct ? "red" : ratePct > amberAt ? "amber" : "green";
  const message = {
    grey: "No decisions yet.",
    green: "Raghav mostly agrees with the rules.",
    amber: `Override rate is above ${amberAt}% — look at the reasons.`,
    red: "Halt and re-evaluate the rules.",
  }[status];
  return { status, ratePct, decided, overridden, runsCounted: counted.length, limitPct: ks.overrideRatePct, message };
}

export function outcomeKill(months: MonthLoss[], b: Baseline) {
  const ks = b.killSwitch;
  const sorted = [...months].sort((a, c) => a.month.localeCompare(c.month));
  const recent = sorted.slice(-ks.consecutiveMonths);
  const above = (m: MonthLoss) => m.total > ks.monthlyLossLimit;
  const status: Status = !sorted.length
    ? "grey"
    : recent.length === ks.consecutiveMonths && recent.every(above)
      ? "red"
      : above(sorted[sorted.length - 1])
        ? "amber"
        : "green";
  const message = {
    grey: "No monthly losses entered yet.",
    green: "Losses are within the limit.",
    amber: "Last month was above the limit — one more month triggers the kill switch.",
    red: "Stop, run a root-cause analysis, fix, redeploy.",
  }[status];
  return { status, limit: ks.monthlyLossLimit, latest: sorted.at(-1) ?? null, message };
}

/** Savings vs the baseline midpoint, averaged over up to the last 3 months, and months to repay the build. */
export function payback(months: MonthLoss[], b: Baseline) {
  const band = monthlyLossBand(b);
  const recent = [...months].sort((a, c) => a.month.localeCompare(c.month)).slice(-3);
  if (!recent.length) return { baselineMonthly: band.mid, avgLoss: null, monthlySavings: null, paybackMonths: null, buildCost: b.buildCost };
  const avgLoss = recent.reduce((a, m) => a + m.total, 0) / recent.length;
  const monthlySavings = band.mid - avgLoss;
  return {
    baselineMonthly: band.mid,
    avgLoss,
    monthlySavings,
    paybackMonths: monthlySavings > 0 ? Math.round((b.buildCost / monthlySavings) * 10) / 10 : null,
    buildCost: b.buildCost,
  };
}

export function killSwitch(runs: RunDecisions[], months: MonthLoss[], b: Baseline) {
  const early = earlyKill(runs, b);
  const outcome = outcomeKill(months, b);
  return { overall: worst(early.status, outcome.status), early, outcome, payback: payback(months, b) };
}
