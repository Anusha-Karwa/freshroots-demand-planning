import { requireUser } from "@/lib/auth";
import { exceptionsForRun, latestRun } from "@/lib/queries";
import { EXCEPTION_LABEL, FLAG_LABEL } from "@/lib/rules/reason";
import type { ExceptionType, Flag } from "@/lib/rules/engine";
import { Badge, Card, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { num } from "@/lib/ui/format";
import { decideExceptionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const run = await latestRun();
  if (!run) return <Notice>No forecast run yet. Run one from the Overview page.</Notice>;
  const exs = await exceptionsForRun(run.id);
  const canDecide = user.role === "planner";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Exceptions queue</h1>
        <p className="text-sm text-stone-600">
          Run #{run.id}. Cases the rules can’t decide — new SKUs, one distributor driving the change, big week-on-week swings,
          or rules that contradict each other. No quantity is suggested; it’s your judgement, with a note.
        </p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}
      {exs.length === 0 && <Notice>No exceptions in this run.</Notice>}

      {exs.map((e) => {
        const m = e.metrics;
        return (
          <Card
            key={e.id}
            title={
              <span>
                {e.skuId} <span className="font-normal text-stone-500">{e.sku?.name}</span>
              </span>
            }
            right={<Badge kind={e.status}>{e.status.replace("_", " ")}</Badge>}
          >
            <div className="flex flex-wrap gap-1">
              {(e.types as ExceptionType[]).map((t) => (
                <Badge key={t}>{EXCEPTION_LABEL[t]}</Badge>
              ))}
            </div>
            <p className="mt-2 text-sm">{e.aiNote}</p>
            <p className="mt-1 text-xs text-stone-400">note: {e.aiNoteSource === "gemini" ? "Gemini" : "template (mock)"}</p>
            <p className="mt-2 text-xs text-stone-500">
              {m.weeksOfHistory} weeks of history · 4-wk avg {num(m.avg4, 1)} · 12-wk avg {num(m.avg12, 1)} · last week{" "}
              {num(m.lastWeekUnits)} (prev {m.prevWeekUnits === null ? "—" : num(m.prevWeekUnits)}) · stock {num(m.stockOnHand)} ·{" "}
              {m.weeksOfCover === null ? "—" : num(m.weeksOfCover, 1)} wk cover · std qty {num(m.standardOrderQty)}
              {m.ruleFlags.length > 0 && <> · rules alone: {m.ruleFlags.map((f) => FLAG_LABEL[f as Flag]).join(", ")}</>}
            </p>

            {e.status !== "open" && (
              <p className="mt-2 text-sm">
                {e.status === "ordered" ? <>Order <b>{num(e.plannerQty ?? 0)}</b></> : "No action"} — “{e.plannerNote}”{" "}
                <span className="text-xs text-stone-400">({e.decidedBy})</span>
              </p>
            )}
            {canDecide && !e.purchaseOrderId && (
              <div className="mt-3 flex flex-wrap gap-2">
                <details>
                  <summary className={`${btnCls} cursor-pointer list-none`}>Order…</summary>
                  <form action={decideExceptionAction} className="mt-2 flex w-64 flex-col gap-2">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="kind" value="order" />
                    <input name="qty" type="number" min={1} step={1} required defaultValue={e.plannerQty ?? m.standardOrderQty} className={inputCls} />
                    <input name="note" required minLength={3} placeholder="Why (required)" className={inputCls} />
                    <button className={btnCls}>Save order</button>
                  </form>
                </details>
                <details>
                  <summary className={`${btnGhostCls} cursor-pointer list-none`}>No action…</summary>
                  <form action={decideExceptionAction} className="mt-2 flex w-64 flex-col gap-2">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="kind" value="no_action" />
                    <input name="note" required minLength={3} placeholder="Why (required)" className={inputCls} />
                    <button className="rounded bg-stone-700 px-3 py-1.5 text-sm text-white">Save</button>
                  </form>
                </details>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
