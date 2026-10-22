import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { dataStatus } from "@/lib/data-status";
import { getBaseline } from "@/lib/settings";
import { monthlyLossBand } from "@/lib/config/baseline";
import { latestRun, recentRuns, recommendationsForRun, exceptionsForRun } from "@/lib/queries";
import { FLAG_LABEL } from "@/lib/rules/reason";
import type { Flag } from "@/lib/rules/engine";
import { Card, Notice, Tile, btnCls } from "@/components/ui";
import { rupees } from "@/lib/ui/format";
import { runForecastNow } from "./actions";
import { killSwitch } from "@/lib/killswitch";
import { decisionsByRun, monthlyLossRows, toMonthLoss } from "@/lib/tracker";
import { KillSwitchPanel } from "@/components/KillSwitchPanel";
import { LossChart } from "@/components/LossChart";

export const dynamic = "force-dynamic";

const IST = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [s, baseline, run, runs, decided, lossRows] = await Promise.all([
    dataStatus(), getBaseline(), latestRun(), recentRuns(6), decisionsByRun(), monthlyLossRows(),
  ]);
  const ks = killSwitch(decided, toMonthLoss(lossRows), baseline);
  const band = monthlyLossBand(baseline);
  const [recs, exs] = run ? await Promise.all([recommendationsForRun(run.id), exceptionsForRun(run.id)]) : [[], []];
  const counts = (run?.counts ?? {}) as { byFlag?: Record<string, number> };
  const pending = recs.filter((r) => r.status === "pending").length;
  const openEx = exs.filter((e) => e.status === "open").length;
  const ageOk = s.dataAgeDays !== null && s.dataAgeDays <= baseline.targetDataAgeDays;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-stone-600">
            Goal: ₹ losses from stockouts + overstock below {rupees(band.low)}–{rupees(band.high)} a month (baseline), acting on
            data ≤ {baseline.targetDataAgeDays} days old.
          </p>
        </div>
        {user.role === "planner" && (
          <form action={runForecastNow}>
            <button className={btnCls}>Run forecast now</button>
          </form>
        )}
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Last run"
          value={run ? `#${run.id}` : "None yet"}
          sub={run ? `${IST(run.startedAt)} · ${run.trigger} · rules v${run.rulesVersion}` : "Runs Mon + Thu 06:00 IST"}
        />
        <Tile
          label="Data age"
          value={s.dataAgeDays === null ? "No data" : `${s.dataAgeDays} days`}
          tone={s.dataAgeDays === null ? undefined : ageOk ? "good" : "bad"}
          sub={s.dataAsOf ? `sales up to ${s.dataAsOf} · target ≤ ${baseline.targetDataAgeDays} days (was 3–4 weeks)` : "load data first"}
        />
        <Tile
          label="Awaiting Raghav"
          value={`${pending} + ${openEx}`}
          tone={pending + openEx ? "warn" : "good"}
          sub={
            <>
              <Link href="/review" className="underline">{pending} recommendation(s)</Link> ·{" "}
              <Link href="/exceptions" className="underline">{openEx} exception(s)</Link>
            </>
          }
        />
        <Tile
          label="Flagged this run"
          value={run ? `${recs.length}` : "—"}
          sub={
            run
              ? (Object.keys(FLAG_LABEL) as Flag[]).map((f) => `${FLAG_LABEL[f]} ${counts.byFlag?.[f] ?? 0}`).join(" · ") +
                ` · Exceptions ${exs.length}`
              : undefined
          }
        />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Kill switch">
          <KillSwitchPanel k={ks} />
        </Card>
        <Card title="Baseline (before the system)">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <dt className="text-stone-500">Stockout losses / quarter</dt>
            <dd>{rupees(baseline.stockoutLossPerQuarter.low)} – {rupees(baseline.stockoutLossPerQuarter.high)}</dd>
            <dt className="text-stone-500">Overstock write-offs / quarter</dt>
            <dd>{rupees(baseline.overstockWriteoffPerQuarter.low)} – {rupees(baseline.overstockWriteoffPerQuarter.high)}</dd>
            <dt className="text-stone-500">Data age at decision</dt>
            <dd>{baseline.dataAgeWeeks.low}–{baseline.dataAgeWeeks.high} weeks</dd>
            <dt className="text-stone-500">Cycle / planner effort</dt>
            <dd>{baseline.planningCycle}, ~{baseline.plannerDaysPerMonth} days/month</dd>
          </dl>
        </Card>
      </div>

      <Card title="₹ losses vs baseline" right={<Link href="/tracker" className="text-sm underline">enter monthly losses</Link>}>
        <LossChart
          data={lossRows.map((r) => ({ month: r.month, stockout: r.stockoutLoss, overstock: r.overstockWriteoff }))}
          band={band}
          limit={baseline.killSwitch.monthlyLossLimit}
        />
      </Card>

      <Card title="Recent runs">
        {runs.length === 0 ? (
          <p className="text-sm text-stone-500">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 pr-3">Run</th>
                  <th className="py-1 pr-3">Started (IST)</th>
                  <th className="py-1 pr-3">Trigger</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Data as of</th>
                  <th className="py-1 pr-3 text-right">Flagged</th>
                  <th className="py-1 pr-3 text-right">Exceptions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const c = (r.counts ?? {}) as { flagged?: number; exceptions?: number };
                  return (
                    <tr key={r.id} className="border-t border-stone-100">
                      <td className="py-1 pr-3">#{r.id}</td>
                      <td className="py-1 pr-3">{IST(r.startedAt)}</td>
                      <td className="py-1 pr-3">{r.trigger}</td>
                      <td className={`py-1 pr-3 ${r.status === "failed" ? "text-red-700" : ""}`}>{r.status}{r.error ? `: ${r.error}` : ""}</td>
                      <td className="py-1 pr-3">{r.dataAsOf ?? "—"}</td>
                      <td className="py-1 pr-3 text-right">{c.flagged ?? "—"}</td>
                      <td className="py-1 pr-3 text-right">{c.exceptions ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
