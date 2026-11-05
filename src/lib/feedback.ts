import { and, desc, inArray, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { num } from "@/lib/format";

/**
 * The feedback loop (components map: Raghav's final call → back into the system as input).
 * Raghav's decisions and reasons come back three ways, and none of them changes a rule quantity:
 *  1. each card shows his last decision on that SKU,
 *  2. Gemini reads that decision as context when it explains the new flag and decides what looks unusual,
 *  3. the Tracker spots SKUs he keeps overriding the same way, so he can fix the rule or the master data at the source.
 */

export interface PastDecision {
  skuId: string;
  runId: number;
  runItemId: number;
  decision: string; // approved | edited | rejected
  recommendedQty: number | null;
  finalQty: number | null;
  reason: string | null;
  decidedBy: string;
  createdAt: Date;
}

export type Direction = "kept" | "down" | "up" | "rejected";

export function direction(d: Pick<PastDecision, "decision" | "recommendedQty" | "finalQty">): Direction {
  if (d.decision === "rejected") return "rejected";
  if (d.recommendedQty == null || d.finalQty == null || d.finalQty === d.recommendedQty) return "kept";
  return d.finalQty < d.recommendedQty ? "down" : "up";
}

/** "Edited 750 → 500 — “promo ending”", short enough for a card and for Gemini's context. */
export function describeDecision(d: PastDecision): string {
  const dir = direction(d);
  const what = dir === "rejected" ? "Rejected the recommendation"
    : dir === "kept" ? `Approved ${num(d.finalQty)}`
    : d.recommendedQty == null ? `Set ${num(d.finalQty)}`
    : `${dir === "down" ? "Cut" : "Raised"} ${num(d.recommendedQty)} → ${num(d.finalQty)}`;
  return `${what}${d.reason && !d.reason.startsWith("Bulk approved") ? ` — “${d.reason}”` : ""}`;
}

/** Every decision is logged; a line decided twice keeps only its latest entry. */
function latestPerItem(rows: PastDecision[]) {
  const byItem = new Map<number, PastDecision>();
  for (const r of rows) {
    const cur = byItem.get(r.runItemId);
    if (!cur || r.createdAt > cur.createdAt) byItem.set(r.runItemId, r);
  }
  return [...byItem.values()];
}

const select = {
  skuId: schema.decisionLog.skuId, runId: schema.decisionLog.runId, runItemId: schema.decisionLog.runItemId,
  decision: schema.decisionLog.decision, recommendedQty: schema.decisionLog.recommendedQty, finalQty: schema.decisionLog.finalQty,
  reason: schema.decisionLog.reason, decidedBy: schema.decisionLog.decidedBy, createdAt: schema.decisionLog.createdAt,
};

/** Raghav's most recent decision on each SKU, from runs before `beforeRunId`. */
export async function lastDecisions(db: Db, skuIds: string[], beforeRunId: number): Promise<Map<string, PastDecision>> {
  if (!skuIds.length) return new Map();
  const rows = await db.select(select).from(schema.decisionLog)
    .where(and(inArray(schema.decisionLog.skuId, skuIds), lt(schema.decisionLog.runId, beforeRunId)))
    .orderBy(desc(schema.decisionLog.runId), desc(schema.decisionLog.id));
  const out = new Map<string, PastDecision>();
  for (const r of latestPerItem(rows as PastDecision[]).sort((a, b) => b.runId - a.runId || +b.createdAt - +a.createdAt)) {
    if (!out.has(r.skuId)) out.set(r.skuId, r);
  }
  return out;
}

/** The line Gemini receives in its context for this SKU. */
export function feedbackContext(d: PastDecision): string {
  return `Planner's last decision on this SKU (run #${d.runId}): ${describeDecision(d)}.`;
}

export interface OverridePattern {
  skuId: string;
  direction: Exclude<Direction, "kept">;
  count: number; // overrides in that direction
  decided: number; // decisions on this SKU in the window
  runs: number[];
  lastReason: string | null;
}

/**
 * A SKU Raghav keeps overriding the same way: at least `minCount` overrides in one direction, and that direction is at
 * least half of his decisions on it in the window. Pure; exported for tests.
 */
export function findPatterns(decisions: PastDecision[], minCount = 2): OverridePattern[] {
  const bySku = new Map<string, PastDecision[]>();
  for (const d of latestPerItem(decisions)) bySku.set(d.skuId, [...(bySku.get(d.skuId) ?? []), d]);
  const out: OverridePattern[] = [];
  for (const [skuId, ds] of bySku) {
    const counts = new Map<OverridePattern["direction"], PastDecision[]>();
    for (const d of ds) {
      const dir = direction(d);
      if (dir !== "kept") counts.set(dir, [...(counts.get(dir) ?? []), d]);
    }
    const [dir, hits] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    if (!dir || !hits || hits.length < minCount || hits.length * 2 < ds.length) continue;
    const latest = [...hits].sort((a, b) => b.runId - a.runId)[0];
    out.push({ skuId, direction: dir, count: hits.length, decided: ds.length, runs: hits.map((h) => h.runId).sort((a, b) => a - b), lastReason: latest.reason });
  }
  return out.sort((a, b) => b.count - a.count || a.skuId.localeCompare(b.skuId));
}

/** Patterns across the last `runs` runs that have any decisions. */
export async function overridePatterns(db: Db, runs = 4): Promise<{ patterns: OverridePattern[]; runIds: number[] }> {
  const recent = await db.selectDistinct({ runId: schema.decisionLog.runId }).from(schema.decisionLog)
    .orderBy(desc(schema.decisionLog.runId)).limit(runs);
  const runIds = recent.map((r) => r.runId);
  if (!runIds.length) return { patterns: [], runIds };
  const rows = await db.select(select).from(schema.decisionLog).where(inArray(schema.decisionLog.runId, runIds));
  return { patterns: findPatterns(rows as PastDecision[]), runIds };
}

export function patternAdvice(p: OverridePattern): string {
  if (p.direction === "down") return "The rule quantity looks too high for this SKU. Consider a lower standard order quantity in the SKU master, or check the high-demand multiplier in Rules config.";
  if (p.direction === "up") return "The rule quantity looks too low for this SKU. Consider a higher standard order quantity in the SKU master.";
  return "The flag keeps being rejected. Check whether its cover window fits (perishable list or thresholds in Rules config).";
}
