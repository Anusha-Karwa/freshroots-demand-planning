import { decideAction } from "@/app/actions";
import type { QueueRow } from "@/lib/queries";
import { num } from "@/lib/format";
import { Badge } from "./ui";

const DECISION_TONE = { approved: "good", edited: "info", rejected: "bad", pending: "mute" } as const;

export function DecisionStatus({ row }: { row: QueueRow }) {
  const { item } = row;
  if (item.decision === "pending") return null;
  return (
    <div className="space-y-1 text-sm">
      <Badge tone={DECISION_TONE[item.decision as keyof typeof DECISION_TONE] ?? "mute"}>
        {item.decision === "rejected" ? "Rejected" : `${item.decision === "edited" ? "Edited to" : "Approved"} ${num(item.finalQty)}`}
      </Badge>
      {item.decisionReason && <div className="text-[var(--text-2)]">“{item.decisionReason}”</div>}
      <div className="text-xs text-[var(--text-3)]">by {item.decidedBy}{item.poId ? ` · on PO #${item.poId}` : ""}</div>
    </div>
  );
}

const btn = "w-full rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap transition";
const primary = `${btn} bg-[var(--green)] text-[var(--ink)] hover:brightness-95 hover:scale-[1.02]`;
const secondary = `${btn} bg-[var(--ink)] text-white hover:opacity-90`;
const danger = `${btn} border border-[rgb(23_30_25/0.2)] bg-[var(--surface)] text-[var(--bad)] hover:bg-[var(--bad-bg)]`;

function Hidden({ row, back }: { row: QueueRow; back: string }) {
  return (
    <>
      <input type="hidden" name="itemId" value={row.item.id} />
      <input type="hidden" name="skuId" value={row.sku.id} />
      <input type="hidden" name="back" value={back} />
    </>
  );
}

/**
 * Raghav's final call on one line. One obvious action (approve the rule quantity); editing and rejecting
 * sit one click away and need a reason. For exceptions there is no rule quantity: Raghav enters one.
 */
export function DecisionForm({ row, back, exception = false }: { row: QueueRow; back: string; exception?: boolean }) {
  const { item } = row;
  if (item.poId) return null;
  if (item.decision !== "pending") {
    return (
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-[var(--text-2)]">Change decision</summary>
        <div className="mt-2">{exception ? <ExceptionFields row={row} back={back} /> : <ReviewFields row={row} back={back} />}</div>
      </details>
    );
  }
  return exception ? <ExceptionFields row={row} back={back} /> : <ReviewFields row={row} back={back} />;
}

function ReviewFields({ row, back }: { row: QueueRow; back: string }) {
  const { item, sku } = row;
  const qty = item.recommendedQty;
  return (
    <div className="space-y-2">
      <form action={decideAction}>
        <Hidden row={row} back={back} />
        <button name="decision" value="approved" className={primary}>{qty === 0 ? "Approve: pause order" : `Approve ${num(qty)}`}</button>
      </form>
      <details className="text-sm">
        <summary className="cursor-pointer text-center text-[var(--text-2)] hover:text-[var(--text)]">Change quantity or reject</summary>
        <form action={decideAction} className="mt-2 space-y-2">
          <Hidden row={row} back={back} />
          <label className="block text-xs text-[var(--text-3)]">New quantity
            <input name="qty" type="number" min={0} step="any" inputMode="decimal" aria-label={`Quantity for ${sku.id}`} placeholder={qty != null ? String(qty) : ""} className="num mt-0.5 w-full" />
          </label>
          <label className="block text-xs text-[var(--text-3)]">Reason (required)
            <input name="reason" aria-label={`Reason for ${sku.id}`} placeholder="e.g. distributor promo ending" className="mt-0.5 w-full" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button name="decision" value="edited" className={secondary}>Save quantity</button>
            <button name="decision" value="rejected" className={danger}>Reject</button>
          </div>
        </form>
      </details>
    </div>
  );
}

function ExceptionFields({ row, back }: { row: QueueRow; back: string }) {
  const { item, sku } = row;
  const suggested = item.metrics.ruleSuggestedQty;
  return (
    <form action={decideAction} className="space-y-2">
      <Hidden row={row} back={back} />
      <label className="block text-xs text-[var(--text-3)]">Quantity to order (0 = none)
        <input name="qty" type="number" min={0} step="any" inputMode="decimal" aria-label={`Quantity for ${sku.id}`}
          defaultValue={suggested ?? undefined} placeholder="qty" className="num mt-0.5 w-full text-base" />
      </label>
      <label className="block text-xs text-[var(--text-3)]">Note (needed to reject)
        <input name="reason" aria-label={`Note for ${sku.id}`} className="mt-0.5 w-full" />
      </label>
      <button name="decision" value="approved" className={primary}>Set quantity</button>
      <button name="decision" value="rejected" className={danger}>Reject</button>
    </form>
  );
}
