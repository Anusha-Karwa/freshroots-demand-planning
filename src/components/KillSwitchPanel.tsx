import type { killSwitch, Status } from "@/lib/killswitch";
import { rupees } from "@/lib/ui/format";

const STYLE: Record<Status, { dot: string; label: string; box: string }> = {
  green: { dot: "bg-emerald-600", label: "Green", box: "border-emerald-200" },
  amber: { dot: "bg-amber-500", label: "Amber", box: "border-amber-300" },
  red: { dot: "bg-red-600", label: "Red", box: "border-red-300" },
  grey: { dot: "bg-stone-400", label: "No data", box: "border-stone-200" },
};

function Light({ status, title, children }: { status: Status; title: string; children: React.ReactNode }) {
  const s = STYLE[status];
  return (
    <div className={`rounded border bg-white p-3 ${s.box}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={`inline-block h-3 w-3 rounded-full ${s.dot}`} aria-hidden />
        {title}: <span>{s.label}</span>
      </div>
      <div className="mt-1 text-xs text-stone-600">{children}</div>
    </div>
  );
}

export function KillSwitchPanel({ k }: { k: ReturnType<typeof killSwitch> }) {
  const p = k.payback;
  return (
    <div className="space-y-2">
      <Light status={k.overall} title="Kill switch">
        {k.overall === "red" ? (k.early.status === "red" ? k.early.message : k.outcome.message) : k.overall === "grey" ? "Waiting for decisions and monthly losses." : "Keep going."}
      </Light>
      <div className="grid gap-2 sm:grid-cols-2">
        <Light status={k.early.status} title="Early: Raghav’s overrides">
          {k.early.ratePct === null ? "No decisions yet." : `${k.early.ratePct}% edited or rejected (${k.early.overridden} of ${k.early.decided}) over the last ${k.early.runsCounted} run(s); red above ${k.early.limitPct}%.`}{" "}
          {k.early.status !== "grey" && k.early.message}
        </Light>
        <Light status={k.outcome.status} title="Outcome: monthly ₹ losses">
          {k.outcome.latest ? `Latest ${k.outcome.latest.month}: ${rupees(k.outcome.latest.total)}; red above ${rupees(k.outcome.limit)} for 2 months running.` : ""}{" "}
          {k.outcome.message}
        </Light>
      </div>
      <p className="text-xs text-stone-600">
        Payback on the {rupees(p.buildCost)} build:{" "}
        {p.monthlySavings === null
          ? "needs monthly losses."
          : p.paybackMonths === null
            ? `no savings yet (average loss ${rupees(p.avgLoss!)} vs baseline ${rupees(p.baselineMonthly)}/month).`
            : `${p.paybackMonths} months at ${rupees(p.monthlySavings)}/month saved vs the ${rupees(p.baselineMonthly)} baseline midpoint.`}
      </p>
    </div>
  );
}
