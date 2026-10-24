import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { baselineMonthly, getBaseline, type Baseline } from "@/lib/settings";
import { inr } from "@/lib/format";

/**
 * Pre-build decision #5, kill criteria:
 *  - Early: Raghav edits or rejects > 50% of recommendations over the last 4 runs → red ("halt and re-evaluate rules").
 *  - Outcome: monthly losses above the top of the baseline (₹11 L) for 2 consecutive months → red ("stop, RCA, fix, redeploy").
 * Plus payback: ₹15 L build cost ÷ monthly savings vs the baseline midpoint.
 */

export type Light = "green" | "amber" | "red" | "grey";

export interface RunOverrides { runId: number; decided: number; overridden: number }
export interface MonthLoss { yearMonth: string; total: number }

export interface KillSwitch {
  overall: Light;
  early: { status: Light; pct: number | null; decided: number; overridden: number; runs: number };
  outcome: { status: Light; months: MonthLoss[]; limit: number };
  payback: { months: number | null; savingsPerMonth: number | null; avgLoss: number | null; baselineMid: number };
  messages: string[];
}

const rank: Record<Light, number> = { grey: 0, green: 1, amber: 2, red: 3 };
export const worst = (...ls: Light[]) => ls.reduce((a, b) => (rank[b] > rank[a] ? b : a), "grey" as Light);

/** Pure; exported for tests. runs = most recent first, only runs where Raghav decided something. */
export function earlyStatus(runs: RunOverrides[], b: Baseline) {
  const window = runs.slice(0, b.earlyRuns);
  const decided = window.reduce((s, r) => s + r.decided, 0);
  const overridden = window.reduce((s, r) => s + r.overridden, 0);
  if (!decided) return { status: "grey" as Light, pct: null, decided, overridden, runs: window.length };
  const pct = (overridden / decided) * 100;
  const status: Light = pct > b.earlyRedPct ? "red" : pct > b.earlyAmberPct ? "amber" : "green";
  return { status, pct, decided, overridden, runs: window.length };
}

const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Pure; months = oldest first. Red needs the latest N months to be consecutive and all above the limit. */
export function outcomeStatus(months: MonthLoss[], b: Baseline): Light {
  if (!months.length) return "grey";
  const recent = months.slice(-b.outcomeMonths);
  const consecutive = recent.every((m, i) => i === 0 || nextMonth(recent[i - 1].yearMonth) === m.yearMonth);
  if (recent.length === b.outcomeMonths && consecutive && recent.every((m) => m.total > b.outcomeMonthlyLimit)) return "red";
  if (months[months.length - 1].total > b.outcomeMonthlyLimit) return "amber";
  return "green";
}

/** Pure. Average of the last (up to) 3 months vs the baseline midpoint. */
export function payback(months: MonthLoss[], b: Baseline) {
  const baselineMid = baselineMonthly(b).mid;
  const recent = months.slice(-3);
  if (!recent.length) return { months: null, savingsPerMonth: null, avgLoss: null, baselineMid };
  const avgLoss = recent.reduce((s, m) => s + m.total, 0) / recent.length;
  const savingsPerMonth = baselineMid - avgLoss;
  return { months: savingsPerMonth > 0 ? b.buildCost / savingsPerMonth : null, savingsPerMonth, avgLoss, baselineMid };
}

export async function overridesByRun(db: Db): Promise<RunOverrides[]> {
  const runs = await db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.status, "done")).orderBy(desc(schema.runs.id)).limit(50);
  if (!runs.length) return [];
  const items = await db.select({ runId: schema.runItems.runId, decision: schema.runItems.decision }).from(schema.runItems)
    .where(and(inArray(schema.runItems.runId, runs.map((r) => r.id)), eq(schema.runItems.queue, "review")));
  return runs.map((r) => {
    const mine = items.filter((i) => i.runId === r.id && i.decision !== "pending");
    return { runId: r.id, decided: mine.length, overridden: mine.filter((i) => i.decision !== "approved").length };
  }).filter((r) => r.decided > 0);
}

export async function monthlyTotals(db: Db): Promise<MonthLoss[]> {
  const rows = await db.select().from(schema.monthlyLosses).orderBy(schema.monthlyLosses.yearMonth);
  return rows.map((r) => ({ yearMonth: r.yearMonth, total: r.stockoutLoss + r.overstockWriteoff }));
}

export async function computeKillSwitch(db: Db): Promise<KillSwitch> {
  const b = await getBaseline(db);
  const early = earlyStatus(await overridesByRun(db), b);
  const months = await monthlyTotals(db);
  const outcome = { status: outcomeStatus(months, b), months, limit: b.outcomeMonthlyLimit };
  const messages: string[] = [];
  if (early.status === "red" || early.status === "amber")
    messages.push(`Raghav edited or rejected ${Math.round(early.pct!)}% of ${early.decided} recommendations over the last ${early.runs} run(s) (red above ${b.earlyRedPct}%).`);
  if (outcome.status === "red")
    messages.push(`Losses above ${inr(b.outcomeMonthlyLimit)}/month for ${b.outcomeMonths} consecutive months (latest ${inr(months[months.length - 1].total)}).`);
  else if (outcome.status === "amber")
    messages.push(`Latest month's losses ${inr(months[months.length - 1].total)} are above ${inr(b.outcomeMonthlyLimit)}.`);
  return { overall: worst(early.status, outcome.status), early, outcome, payback: payback(months, b), messages };
}
