import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { daysBetween, todayIst } from "@/lib/dates";
import { latestRun } from "@/lib/forecast/run";
import { latestSalesWeek } from "@/lib/forecast/inputs";
import { dateLabel, dateTimeLabel, inr, num } from "@/lib/format";
import { computeKillSwitch } from "@/lib/killswitch";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { baselineMonthly, getBaseline } from "@/lib/settings";
import { Button, Card, Empty, Flash, PageHeader, Stat, TextLink } from "@/components/ui";
import { KillSwitchPanel } from "@/components/KillSwitchPanel";
import { LossChart } from "@/components/LossChart";
import { runForecastNow } from "../actions";

export default async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const [run, baseline, ks, lastWeek, runs, losses, decisions] = await Promise.all([
    latestRun(db), getBaseline(db), computeKillSwitch(db), latestSalesWeek(db),
    db.select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(6),
    db.select().from(schema.monthlyLosses).orderBy(schema.monthlyLosses.yearMonth),
    db.select({ age: schema.decisionLog.dataAgeDays }).from(schema.decisionLog).orderBy(desc(schema.decisionLog.id)).limit(50),
  ]);
  const today = todayIst();
  const monthly = baselineMonthly(baseline);
  const dataAge = run?.dataThrough ? daysBetween(run.dataThrough, today) : null;
  const ageAtDecision = decisions.filter((d) => d.age != null);
  const avgAgeAtDecision = ageAtDecision.length ? ageAtDecision.reduce((s, d) => s + d.age!, 0) / ageAtDecision.length : null;
  const c = run?.summary ?? {};
  const pending = run
    ? await db.select({ queue: schema.runItems.queue }).from(schema.runItems)
      .where(and(eq(schema.runItems.runId, run.id), eq(schema.runItems.decision, "pending")))
    : [];
  const pendingReview = pending.filter((p) => p.queue === "review").length;
  const pendingExceptions = pending.filter((p) => p.queue === "exception").length;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Goal: bring ₹ losses from stockouts and overstock write-offs below the ₹28–34 L/quarter baseline, with procurement acting on data no more than 4 days old."
        actions={session.role === "planner" && (
          <form action={runForecastNow}><Button>Run forecast now</Button></form>
        )}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      {!lastWeek && (
        <div className="mb-4"><Empty>No sales data yet. <TextLink href="/data">Load the seed data or upload a SAP export</TextLink>.</Empty></div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Last run" value={run ? dateTimeLabel(run.finishedAt) : "—"} sub={run ? `#${run.id} · ${run.trigger} · next: Mon & Thu 06:00 IST` : "Runs Mon & Thu 06:00 IST"} />
        <Stat
          label="Data age"
          value={dataAge == null ? "—" : `${dataAge} day${dataAge === 1 ? "" : "s"}`}
          tone={dataAge == null ? undefined : dataAge <= baseline.dataAgeTargetDays ? "good" : dataAge <= 14 ? "warn" : "bad"}
          sub={run?.dataThrough ? `Sales through ${dateLabel(run.dataThrough)} · target ≤ ${baseline.dataAgeTargetDays} days (was ~${baseline.dataAgeDaysBaseline})` : undefined}
        />
        <Stat
          label="Awaiting Raghav"
          value={<TextLink href="/review">{pendingReview} to review</TextLink>}
          sub={<><TextLink href="/exceptions">{pendingExceptions} exception{pendingExceptions === 1 ? "" : "s"}</TextLink> pending · {num(c.review)} + {num(c.exceptions)} flagged this run{c.aiRouted ? ` (${c.aiRouted} sent to exceptions by Gemini)` : ""}</>}
        />
        <Stat
          label="Flags this run"
          value={<span className="block text-base leading-6">{num(c.stockoutRisk)} stockout risk<br />{num(c.highDemand)} high demand · {num(c.overstockRisk)} overstock</span>}
          sub={run ? `${num(c.skus)} SKUs checked · reasons by ${run.reasonSource === "gemini" ? "Gemini" : "template (mock)"}` : undefined}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="₹ losses vs baseline" className="lg:col-span-2">
          {losses.length ? (
            <LossChart
              months={losses.slice(-12).map((l) => ({ yearMonth: l.yearMonth, stockout: l.stockoutLoss, overstock: l.overstockWriteoff }))}
              baselineLow={monthly.low} baselineHigh={monthly.high} limit={baseline.outcomeMonthlyLimit}
            />
          ) : (
            <Empty>
              No monthly losses entered yet. Baseline is {inr(monthly.low)}–{inr(monthly.high)} per month
              ({inr(baseline.stockoutLossQuarterLow)}–{inr(baseline.stockoutLossQuarterHigh)} stockouts + {inr(baseline.overstockQuarterLow)}–{inr(baseline.overstockQuarterHigh)} overstock per quarter).{" "}
              <TextLink href="/tracker">Enter finance’s monthly figures on the Tracker</TextLink>.
            </Empty>
          )}
        </Card>
        <div className="space-y-4">
          <KillSwitchPanel ks={ks} baseline={baseline} />
          <Card title="Payback">
            <div className="num text-2xl font-semibold">{ks.payback.months == null ? "—" : `${ks.payback.months.toFixed(1)} months`}</div>
            <div className="mt-1 text-xs text-[var(--text-2)]">
              {inr(baseline.buildCost)} build cost ÷ monthly savings vs the baseline midpoint ({inr(ks.payback.baselineMid)}/month).{" "}
              {ks.payback.savingsPerMonth == null
                ? "Needs at least one month of losses."
                : ks.payback.savingsPerMonth > 0
                  ? `Saving ${inr(ks.payback.savingsPerMonth)}/month (last ${Math.min(3, losses.length)} month avg ${inr(ks.payback.avgLoss)}).`
                  : `Not saving yet: losses average ${inr(ks.payback.avgLoss)}/month.`}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Before → now">
          <table className="data">
            <thead><tr><th>Measure</th><th>Baseline (before)</th><th>Now</th></tr></thead>
            <tbody>
              <tr><td>Planning cycle</td><td>Monthly</td><td>Twice a week (Mon + Thu)</td></tr>
              <tr><td>Data age when procurement acts</td><td>3–4 weeks</td><td className="num">{avgAgeAtDecision == null ? "—" : `${avgAgeAtDecision.toFixed(1)} days (avg at decision)`}</td></tr>
              <tr><td>Stockout lost sales</td><td>{inr(baseline.stockoutLossQuarterLow)}–{inr(baseline.stockoutLossQuarterHigh)}/qtr</td><td className="num">{losses.length ? `${inr(losses.slice(-3).reduce((s, l) => s + l.stockoutLoss, 0))} last ${Math.min(3, losses.length)} mo` : "—"}</td></tr>
              <tr><td>Overstock write-offs</td><td>{inr(baseline.overstockQuarterLow)}–{inr(baseline.overstockQuarterHigh)}/qtr</td><td className="num">{losses.length ? `${inr(losses.slice(-3).reduce((s, l) => s + l.overstockWriteoff, 0))} last ${Math.min(3, losses.length)} mo` : "—"}</td></tr>
              <tr><td>Raghav’s data work</td><td>~{baseline.plannerDaysPerMonth} days/month</td><td>Review queue only</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="Recent runs">
          {runs.length ? (
            <table className="data">
              <thead><tr><th>#</th><th>When</th><th>Trigger</th><th>Data through</th><th className="r">Review</th><th className="r">Exceptions</th><th>Status</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.id}</td>
                    <td>{dateTimeLabel(r.startedAt)}</td>
                    <td>{r.trigger}</td>
                    <td>{dateLabel(r.dataThrough)}</td>
                    <td className="r num">{num(r.summary?.review)}</td>
                    <td className="r num">{num(r.summary?.exceptions)}</td>
                    <td title={r.error ?? undefined}>{r.status}{r.error ? " ⚠" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No runs yet.</Empty>}
        </Card>
      </div>
    </>
  );
}
