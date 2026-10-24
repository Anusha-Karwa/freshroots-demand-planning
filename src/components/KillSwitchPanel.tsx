import { inr, monthLabel, pct } from "@/lib/format";
import type { KillSwitch } from "@/lib/killswitch";
import type { Baseline } from "@/lib/settings";
import { Card, StatusLight } from "./ui";

export function KillSwitchPanel({ ks, baseline }: { ks: KillSwitch; baseline: Baseline }) {
  const latest = ks.outcome.months[ks.outcome.months.length - 1];
  return (
    <Card title="Kill switch" right={<StatusLight status={ks.overall} />}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">Early: Raghav’s override rate</div>
            <div className="text-xs text-[var(--text-2)]">
              Edited or rejected over the last {baseline.earlyRuns} runs. Red above {baseline.earlyRedPct}% → halt and re-evaluate the rules.
            </div>
            <div className="num mt-1 text-sm">
              {ks.early.pct == null ? "No decisions yet" : `${pct(ks.early.pct, false)} (${ks.early.overridden} of ${ks.early.decided}, ${ks.early.runs} run${ks.early.runs === 1 ? "" : "s"})`}
            </div>
          </div>
          <StatusLight status={ks.early.status} />
        </div>
        <div className="flex items-start justify-between gap-3 border-t border-[var(--border)] pt-3">
          <div>
            <div className="font-medium">Outcome: monthly ₹ losses</div>
            <div className="text-xs text-[var(--text-2)]">
              Red when above {inr(baseline.outcomeMonthlyLimit)}/month for {baseline.outcomeMonths} consecutive months → stop, root-cause, fix, redeploy.
            </div>
            <div className="num mt-1 text-sm">{latest ? `Latest (${monthLabel(latest.yearMonth)}): ${inr(latest.total)}` : "No monthly losses entered yet (Tracker page)"}</div>
          </div>
          <StatusLight status={ks.outcome.status} />
        </div>
        {ks.messages.length > 0 && (
          <ul className="list-disc space-y-1 rounded-md bg-[var(--surface-2)] p-3 pl-6 text-xs">
            {ks.messages.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}
