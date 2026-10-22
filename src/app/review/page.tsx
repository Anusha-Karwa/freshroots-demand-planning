import { requireUser } from "@/lib/auth";
import { latestRun, recommendationsForRun } from "@/lib/queries";
import { FLAG_LABEL } from "@/lib/rules/reason";
import type { Flag } from "@/lib/rules/engine";
import { Badge, Card, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { num } from "@/lib/ui/format";
import { bulkApprove, decide } from "../actions";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = { REORDER: "Reorder", REORDER_NOW: "Reorder now", PAUSE_NEXT_ORDER: "Pause next order" };

type Rec = Awaited<ReturnType<typeof recommendationsForRun>>[number];

function Numbers({ r }: { r: Rec }) {
  const m = r.metrics;
  return (
    <div className="text-xs text-stone-500">
      4-wk avg {num(m.avg4, 1)} · 12-wk avg {num(m.avg12, 1)} · expected {num(m.expectedWeekly, 1)}/wk
      {m.festival && ` (festival ×${m.uplift})`} · window {m.coverWindow.minWeeks}–{m.coverWindow.maxWeeks} wk · std qty {num(m.standardOrderQty)}
    </div>
  );
}

function DecisionForms({ r }: { r: Rec }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {r.status !== "approved" && (
        <form action={decide}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="approve" />
          <button className={btnCls}>{r.action === "PAUSE_NEXT_ORDER" ? "Approve pause" : `Approve ${num(r.recommendedQty)}`}</button>
        </form>
      )}
      <details className="group">
        <summary className={`${btnGhostCls} cursor-pointer list-none`}>Edit qty</summary>
        <form action={decide} className="mt-2 flex w-64 flex-col gap-2">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="kind" value="edit" />
          <input name="qty" type="number" min={0} step={1} required defaultValue={r.finalQty ?? r.recommendedQty} className={inputCls} />
          <input name="reason" required minLength={3} placeholder="Reason (required)" className={inputCls} />
          <button className={btnCls}>Save quantity</button>
        </form>
      </details>
      {r.status !== "rejected" && (
        <details>
          <summary className={`${btnGhostCls} cursor-pointer list-none`}>Reject</summary>
          <form action={decide} className="mt-2 flex w-64 flex-col gap-2">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="kind" value="reject" />
            <input name="reason" required minLength={3} placeholder="Reason (required)" className={inputCls} />
            <button className="rounded bg-stone-700 px-3 py-1.5 text-sm text-white">Reject</button>
          </form>
        </details>
      )}
    </div>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const run = await latestRun();
  if (!run) return <Notice>No forecast run yet. Run one from the Overview page.</Notice>;
  const recs = await recommendationsForRun(run.id);
  const canDecide = user.role === "planner";
  const bulkable = recs.filter((r) => r.primaryFlag === "STOCKOUT_RISK" && r.status === "pending" && !r.purchaseOrderId);
  const decided = recs.filter((r) => r.status !== "pending").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Review queue</h1>
        <p className="text-sm text-stone-600">
          Run #{run.id} · data as of {run.dataAsOf} · {recs.length} flagged · {decided} decided. The rules set the quantity;
          you make the call. Edits and rejections need a reason. Nothing is ordered without your approval.
        </p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}
      {!canDecide && <Notice>You are signed in as a viewer: read-only.</Notice>}

      {canDecide && bulkable.length > 1 && (
        <Card title={`Bulk approve stockout lines (${bulkable.length})`}>
          <form action={bulkApprove} className="space-y-2 text-sm">
            <input type="hidden" name="runId" value={run.id} />
            <p className="text-stone-600">Only stockout-risk lines can be bulk-approved. Untick any you want to look at separately.</p>
            <ul className="space-y-1">
              {bulkable.map((r) => (
                <li key={r.id}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="ids" value={r.id} defaultChecked className="mt-1" />
                    <span>
                      <b>{r.skuId}</b> {r.sku?.name} — {ACTION_LABEL[r.action]} {num(r.recommendedQty)} · stock {num(r.metrics.stockOnHand)} ·{" "}
                      {r.metrics.weeksOfCover === null ? "—" : num(r.metrics.weeksOfCover, 1)} wk cover
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" name="confirm" value="yes" required /> I have reviewed these lines and their numbers
            </label>
            <button className={btnCls}>Approve ticked lines</button>
          </form>
        </Card>
      )}

      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Flag</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Weeks of cover</th>
              <th className="px-3 py-2 text-right">4-wk vs 12-wk</th>
              <th className="px-3 py-2 text-right">Recommended</th>
              <th className="px-3 py-2">Why</th>
              <th className="px-3 py-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {recs.map((r) => {
              const m = r.metrics;
              return (
                <tr key={r.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.skuId}</div>
                    <div className="text-xs text-stone-500">{r.sku?.name}</div>
                    <div className="text-xs text-stone-500">
                      {r.sku?.category} · {m.coverWindow.perishable ? "perishable" : "non-perishable"}
                    </div>
                  </td>
                  <td className="space-y-1 px-3 py-2">
                    {(r.flags as Flag[]).map((f) => (
                      <div key={f}><Badge kind={f}>{FLAG_LABEL[f]}</Badge></div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right">{num(m.stockOnHand)}</td>
                  <td className="px-3 py-2 text-right">
                    {m.weeksOfCover === null ? "—" : num(m.weeksOfCover, 1)}
                    <div className="text-xs text-stone-500">{m.coverWindow.minWeeks}–{m.coverWindow.maxWeeks} wk</div>
                  </td>
                  <td className="px-3 py-2 text-right">{m.pct4v12 === null ? "—" : `${m.pct4v12 > 0 ? "+" : ""}${num(m.pct4v12, 1)}%`}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-medium">{num(r.recommendedQty)}</div>
                    <div className="text-xs text-stone-500">{ACTION_LABEL[r.action]}</div>
                  </td>
                  <td className="max-w-sm px-3 py-2">
                    <p className="whitespace-pre-line">{r.reason}</p>
                    <div className="mt-1"><Numbers r={r} /></div>
                    <div className="mt-1 text-xs text-stone-400">reason: {r.reasonSource === "gemini" ? "Gemini" : "template (mock)"}</div>
                  </td>
                  <td className="min-w-56 px-3 py-2">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge kind={r.status}>{r.status}</Badge>
                      {r.status !== "pending" && <span className="text-xs">final qty {num(r.finalQty ?? 0)}</span>}
                    </div>
                    {r.decisionReason && <p className="mb-1 text-xs text-stone-600">“{r.decisionReason}”</p>}
                    {r.decidedBy && (
                      <p className="mb-2 text-xs text-stone-400">
                        {r.decidedBy}, {r.decidedAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}
                      </p>
                    )}
                    {r.purchaseOrderId ? (
                      <p className="text-xs text-stone-500">On draft PO #{r.purchaseOrderId}</p>
                    ) : (
                      canDecide && <DecisionForms r={r} />
                    )}
                  </td>
                </tr>
              );
            })}
            {recs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-stone-500">No SKUs flagged in this run.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
