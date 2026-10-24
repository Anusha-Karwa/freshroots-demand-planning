import { decideAction } from "@/app/actions";
import type { QueueRow } from "@/lib/queries";
import { num } from "@/lib/format";
import { Badge } from "./ui";

const DECISION_TONE = { approved: "good", edited: "info", rejected: "bad", pending: "mute" } as const;

export function DecisionStatus({ row }: { row: QueueRow }) {
  const { item } = row;
  if (item.decision === "pending") return <Badge>Pending</Badge>;
  return (
    <div className="space-y-1 text-xs">
      <Badge tone={DECISION_TONE[item.decision as keyof typeof DECISION_TONE] ?? "mute"}>
        {item.decision === "rejected" ? "Rejected" : `${item.decision === "edited" ? "Edited" : "Approved"}: ${num(item.finalQty)}`}
      </Badge>
      {item.decisionReason && <div className="text-[var(--text-2)]">“{item.decisionReason}”</div>}
      <div className="text-[var(--text-3)]">{item.decidedBy}{item.poId ? ` · on PO #${item.poId}` : ""}</div>
    </div>
  );
}

/**
 * Raghav's final call on one line. Approve keeps the rule quantity; Edit / Reject need a reason.
 * For exceptions there is no rule quantity: Raghav enters one ("Set qty").
 */
export function DecisionForm({ row, back, exception = false }: { row: QueueRow; back: string; exception?: boolean }) {
  const { item } = row;
  if (item.poId) return null;
  if (item.decision === "pending") return <DecisionFields row={row} back={back} exception={exception} />;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-[var(--text-2)]">Change</summary>
      <div className="mt-1.5"><DecisionFields row={row} back={back} exception={exception} /></div>
    </details>
  );
}

function DecisionFields({ row, back, exception }: { row: QueueRow; back: string; exception: boolean }) {
  const { item, sku } = row;
  const suggested = exception ? item.metrics.ruleSuggestedQty : item.recommendedQty;
  return (
    <form action={decideAction} className="flex w-52 flex-col gap-1.5">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="skuId" value={sku.id} />
      <input type="hidden" name="back" value={back} />
      <input
          name="qty" type="number" min={0} step="any" inputMode="decimal"
          aria-label={`Quantity for ${sku.id}`}
          placeholder={suggested != null ? String(suggested) : "qty"}
          defaultValue={exception && suggested != null ? suggested : undefined}
          className="num w-full"
        />
        <input name="reason" aria-label={`Reason for ${sku.id}`} placeholder={exception ? "Note (optional)" : "Reason (edit/reject)"} className="w-full" />
      <div className="flex gap-1.5">
        {exception ? (
          <button name="decision" value="approved" className="rounded-md bg-[var(--accent)] whitespace-nowrap px-2 py-1 text-xs font-medium text-[var(--accent-ink)]">Set qty</button>
        ) : (
          <>
            <button name="decision" value="approved" className="rounded-md bg-[var(--accent)] whitespace-nowrap px-2 py-1 text-xs font-medium text-[var(--accent-ink)]">{suggested === 0 ? "Approve pause" : `Approve ${num(suggested)}`}</button>
            <button name="decision" value="edited" className="rounded-md border border-[var(--border)] whitespace-nowrap px-2 py-1 text-xs font-medium">Edit qty</button>
          </>
        )}
        <button name="decision" value="rejected" className="rounded-md border border-[var(--border)] whitespace-nowrap px-2 py-1 text-xs font-medium text-[var(--bad)]">Reject</button>
      </div>
    </form>
  );
}
