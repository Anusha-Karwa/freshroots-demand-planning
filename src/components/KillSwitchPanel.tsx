import { inr, monthLabel, pct } from "@/lib/format";
import type { KillSwitch } from "@/lib/killswitch";
import type { Baseline } from "@/lib/settings";
import { Card, StatusLight } from "./ui";

/** Two checks, one line each; the rules behind them sit under "How it works". */
export function KillSwitchPanel({ ks, baseline }: { ks: KillSwitch; baseline: Baseline }) {
  const latest = ks.outcome.months[ks.outcome.months.length - 1];
  const checks = [
    {
      name: "Override rate",
      value: ks.early.pct == null ? "No decisions yet" : `${pct(ks.early.pct, false)} edited or rejected`,
      status: ks.early.status,
    },
    {
      name: "Monthly losses",
      value: latest ? `${inr(latest.total)} in ${monthLabel(latest.yearMonth)}` : "None entered yet",
      status: ks.outcome.status,
    },
  ];
  return (
    <Card title="Kill switch" right={<StatusLight status={ks.overall} />}>
      <ul className="divide-y divide-[var(--border)]">
        {checks.map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-3 py-2 first:pt-0">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="num text-sm text-[var(--text-2)]">{c.value}</div>
            </div>
            <StatusLight status={c.status} />
          </li>
        ))}
      </ul>
      {ks.messages.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 rounded-md bg-[var(--surface-2)] p-3 pl-6 text-sm">
          {ks.messages.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      <details className="mt-3 text-sm text-[var(--text-2)]">
        <summary className="cursor-pointer">How it works</summary>
        <p className="mt-2">
          <b>Override rate:</b> share of lines edited or rejected over the last {baseline.earlyRuns} runs. Red above {baseline.earlyRedPct}% → halt and re-check the rules.
          {ks.early.pct != null && ` Now ${ks.early.overridden} of ${ks.early.decided} across ${ks.early.runs} run${ks.early.runs === 1 ? "" : "s"}.`}
        </p>
        <p className="mt-1.5">
          <b>Monthly losses:</b> red when above {inr(baseline.outcomeMonthlyLimit)} a month for {baseline.outcomeMonths} months in a row → stop, find the cause, fix, redeploy.
        </p>
      </details>
    </Card>
  );
}
