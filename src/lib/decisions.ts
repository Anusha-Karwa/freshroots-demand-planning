import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { User } from "@/lib/auth";
import { rulesConfigSchema, type RulesConfig } from "@/lib/config/rules";

/**
 * Raghav's final call. Rules set the recommended quantity; only these functions change what gets ordered,
 * and every change records who, when and why.
 */

export type Decision =
  | { kind: "approve" }
  | { kind: "edit"; qty: number; reason: string }
  | { kind: "reject"; reason: string };

/** Validates a decision from form input. Edit and reject need a reason; quantities are whole and ≥ 0. */
export function parseDecision(kind: string, qtyRaw: unknown, reasonRaw: unknown): Decision {
  const reason = String(reasonRaw ?? "").trim();
  if (kind === "approve") return { kind };
  if (kind === "reject") {
    if (reason.length < 3) throw new Error("A reason is required to reject.");
    return { kind, reason };
  }
  if (kind === "edit") {
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 0) throw new Error("Quantity must be a whole number ≥ 0.");
    if (reason.length < 3) throw new Error("A reason is required to change the quantity.");
    return { kind, qty, reason };
  }
  throw new Error(`Unknown decision "${kind}".`);
}

/** Still changeable: not yet turned into a purchase order. */
const open = isNull(schema.recommendations.purchaseOrderId);

export async function decideRecommendation(id: number, d: Decision, user: User) {
  const db = await getDb();
  const [rec] = await db.select().from(schema.recommendations).where(eq(schema.recommendations.id, id));
  if (!rec) throw new Error("Recommendation not found.");
  if (rec.purchaseOrderId) throw new Error("Already on a purchase order; change it in the PO instead.");
  const set =
    d.kind === "approve"
      ? { status: "approved", finalQty: rec.recommendedQty, decisionReason: null }
      : d.kind === "edit"
        ? { status: d.qty === rec.recommendedQty ? "approved" : "edited", finalQty: d.qty, decisionReason: d.reason }
        : { status: "rejected", finalQty: 0, decisionReason: d.reason };
  await db
    .update(schema.recommendations)
    .set({ ...set, decidedBy: user.name, decidedAt: new Date() })
    .where(and(eq(schema.recommendations.id, id), open));
}

/** Bulk approve is allowed for STOCKOUT_RISK lines only, and only the ids the planner confirmed on screen. */
export async function bulkApproveStockout(runId: number, ids: number[], user: User) {
  if (!ids.length) return 0;
  const db = await getDb();
  const rows = await db
    .update(schema.recommendations)
    .set({
      status: "approved",
      finalQty: sql`${schema.recommendations.recommendedQty}`,
      decisionReason: null,
      decidedBy: user.name,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(schema.recommendations.runId, runId),
        inArray(schema.recommendations.id, ids),
        eq(schema.recommendations.primaryFlag, "STOCKOUT_RISK"),
        eq(schema.recommendations.status, "pending"),
        open,
      ),
    )
    .returning({ id: schema.recommendations.id });
  return rows.length;
}

export type ExceptionDecision = { kind: "order"; qty: number; note: string } | { kind: "no_action"; note: string };

export function parseExceptionDecision(kind: string, qtyRaw: unknown, noteRaw: unknown): ExceptionDecision {
  const note = String(noteRaw ?? "").trim();
  if (note.length < 3) throw new Error("A note is required — this is a judgement call.");
  if (kind === "no_action") return { kind, note };
  if (kind === "order") {
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("Order quantity must be a whole number > 0.");
    return { kind, qty, note };
  }
  throw new Error(`Unknown decision "${kind}".`);
}

export async function decideException(id: number, d: ExceptionDecision, user: User) {
  const db = await getDb();
  await db
    .update(schema.exceptions)
    .set({
      status: d.kind === "order" ? "ordered" : "no_action",
      plannerQty: d.kind === "order" ? d.qty : null,
      plannerNote: d.note,
      decidedBy: user.name,
      decidedAt: new Date(),
    })
    .where(and(eq(schema.exceptions.id, id), isNull(schema.exceptions.purchaseOrderId)));
}

/** Saves a new rules version. Returns the new version number. */
export async function saveRules(config: RulesConfig, note: string, user: User) {
  const parsed = rulesConfigSchema.parse(config);
  if (note.trim().length < 3) throw new Error("Say why the rules changed.");
  const db = await getDb();
  const [row] = await db
    .insert(schema.rulesConfigVersions)
    .values({ config: parsed, changedBy: user.name, note: note.trim() })
    .returning({ version: schema.rulesConfigVersions.version });
  return row.version;
}

export async function rulesHistory() {
  const db = await getDb();
  return db.select().from(schema.rulesConfigVersions).orderBy(desc(schema.rulesConfigVersions.version));
}

/** Human-readable list of what changed between two configs, e.g. "highDemand.thresholdPct: 20 → 25". */
export function diffConfig(a: unknown, b: unknown, prefix = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (x: unknown) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) =>
      diffConfig((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k),
    );
  }
  const show = (x: unknown) => (x === undefined ? "—" : Array.isArray(x) ? `[${x.join(", ")}]` : String(x));
  return [`${prefix}: ${show(a)} → ${show(b)}`];
}
