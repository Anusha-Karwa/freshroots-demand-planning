import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { daysBetween, todayIst } from "@/lib/dates";
import { latestRun } from "@/lib/forecast/run";

/**
 * Raghav's final call. Approve keeps the rules' quantity; Edit changes it; Reject orders nothing.
 * Edit and Reject need a reason. Exceptions have no recommended quantity, so approving one means Raghav sets it.
 * Every call (including a change of mind) is appended to decision_log.
 */

export type Decision = "approved" | "edited" | "rejected";

export class DecisionError extends Error {}

export interface DecideInput { itemId: number; decision: Decision; qty?: number | null; reason?: string | null; by: string }

/** Pure validation, exported for tests. Returns the normalised decision and final quantity. */
export function resolveDecision(
  item: { queue: string; recommendedQty: number | null },
  input: Pick<DecideInput, "decision" | "qty" | "reason">,
): { decision: Decision; finalQty: number; reason: string | null } {
  const reason = input.reason?.trim() || null;
  const qty = input.qty;
  if (qty != null && (!Number.isFinite(qty) || qty < 0)) throw new DecisionError("Quantity must be a number of 0 or more.");

  if (input.decision === "rejected") {
    if (!reason) throw new DecisionError("A reason is required to reject.");
    return { decision: "rejected", finalQty: 0, reason };
  }

  if (item.queue === "exception") {
    // Judgement cases: there is no rule recommendation to approve or edit, Raghav sets the quantity.
    if (qty == null) throw new DecisionError("Set a quantity for this exception (0 to order nothing).");
    return { decision: "approved", finalQty: qty, reason };
  }

  if (input.decision === "approved") return { decision: "approved", finalQty: item.recommendedQty ?? 0, reason };

  if (qty == null) throw new DecisionError("Enter the edited quantity.");
  if (!reason) throw new DecisionError("A reason is required to edit the quantity.");
  // Editing to the recommended quantity is an approval (the reason is still kept).
  if (qty === item.recommendedQty) return { decision: "approved", finalQty: qty, reason };
  return { decision: "edited", finalQty: qty, reason };
}

export async function decide(db: Db, input: DecideInput) {
  const [item] = await db.select().from(schema.runItems).where(eq(schema.runItems.id, input.itemId));
  if (!item) throw new DecisionError("Recommendation not found.");
  const run = await latestRun(db);
  if (!run || item.runId !== run.id) throw new DecisionError("This recommendation is from an older run. Decide on the latest run.");
  if (item.poId) throw new DecisionError("Already on a purchase order; change it in Zoho.");
  if (item.queue === "none") throw new DecisionError("This SKU was not flagged.");

  const r = resolveDecision(item, input);
  await save(db, item, r, input.by, run.dataThrough);
  return r;
}

/** Bulk approve is only for STOCKOUT_RISK lines in the review queue, after Raghav ticks "I have reviewed these". */
export async function bulkApproveStockouts(db: Db, opts: { itemIds: number[]; reviewed: boolean; by: string }) {
  if (!opts.reviewed) throw new DecisionError("Tick “I have reviewed these lines” first.");
  if (!opts.itemIds.length) throw new DecisionError("No lines selected.");
  const run = await latestRun(db);
  if (!run) throw new DecisionError("No run yet.");
  const items = await db.select().from(schema.runItems).where(and(
    inArray(schema.runItems.id, opts.itemIds), eq(schema.runItems.runId, run.id), eq(schema.runItems.queue, "review"),
    eq(schema.runItems.decision, "pending"), isNull(schema.runItems.poId),
  ));
  const eligible = items.filter((i) => i.flags.includes("STOCKOUT_RISK"));
  for (const item of eligible) {
    await save(db, item, { decision: "approved", finalQty: item.recommendedQty ?? 0, reason: "Bulk approved (stockout risk)" }, opts.by, run.dataThrough);
  }
  return eligible.length;
}

async function save(
  db: Db, item: typeof schema.runItems.$inferSelect,
  r: { decision: Decision; finalQty: number; reason: string | null }, by: string, dataThrough: string | null,
) {
  const dataAgeDays = dataThrough ? daysBetween(dataThrough, todayIst()) : null;
  await db.update(schema.runItems).set({
    decision: r.decision, finalQty: r.finalQty, decisionReason: r.reason, decidedBy: by, decidedAt: new Date(),
  }).where(eq(schema.runItems.id, item.id));
  await db.insert(schema.decisionLog).values({
    runItemId: item.id, runId: item.runId, skuId: item.skuId, decision: r.decision,
    recommendedQty: item.recommendedQty, finalQty: r.finalQty, reason: r.reason, decidedBy: by, dataAgeDays,
  });
}
