import Link from "next/link";
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

  const flagged = run ? (c.review ?? 0) + (c.exceptions ?? 0) : null;
  const freshTone = dataAge == null ? undefined : dataAge <= baseline.dataAgeTargetDays ? "good" : dataAge <= 14 ? "warn" : "bad";

  return (
    <>
      <PageHeader
        title={`Hello, ${session.name}`}
        subtitle="Keep stockout and overstock losses under the ₹28–34 L/quarter baseline, ordering on data no more than 4 days old."
        actions={session.role === "planner" && (
          <form action={runForecastNow}><Button>Run forecast now</Button></form>
        )}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      {!lastWeek && (
        <div className="mb-6"><Empty>No sales data yet. <TextLink href="/data">Load the seed data or upload a SAP export</TextLink>.</Empty></div>
      )}

      {run && (
        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          {pendingReview + pendingExceptions > 0 ? (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">{pendingReview + pendingExceptions} decision{pendingReview + pendingExceptions === 1 ? "" : "s"} waiting for you</h2>
                <p className="text-[var(--text-2)]">From run #{run.id} ({dateTimeLabel(run.finishedAt)}). Nothing is ordered until you approve it.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingReview > 0 && <ActionLink href="/review" primary>{pendingReview} to review</ActionLink>}
                {pendingExceptions > 0 && <ActionLink href="/exceptions">{pendingExceptions} exception{pendingExceptions === 1 ? "" : "s"}</ActionLink>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex-1">
                <h2 className="text-lg font-semibold">All caught up</h2>
                <p className="text-[var(--text-2)]">Every line in run #{run.id} is decided. Approved lines become draft POs on the Purchase orders page.</p>
              </div>
              <ActionLink href="/purchase-orders">Purchase orders</ActionLink>
            </div>
          )}
        </section>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Last run" value={run ? dateTimeLabel(run.finishedAt) : "—"} sub={run ? `Next: Mon & Thu, 6:00 am` : "Runs Mon & Thu, 6:00 am"} />
        <Stat
          label="Data freshness"
          value={dataAge == null ? "—" : `${dataAge} day${dataAge === 1 ? "" : "s"} old`}
          tone={freshTone}
          sub={run?.dataThrough ? `Sales through ${dateLabel(run.dataThrough)} · goal ≤ ${baseline.dataAgeTargetDays} days` : undefined}
        />
        <Stat
          label="Flagged this run"
          value={flagged == null ? "—" : `${flagged} of ${num(c.skus)} SKUs`}
          sub={run ? `${num(c.stockoutRisk)} stockout · ${num(c.highDemand)} high demand · ${num(c.overstockRisk)} overstock` : undefined}
        />
      </div>

      <div className="mb-6 grid items-start gap-4 lg:grid-cols-3">
        <Card title="₹ losses vs baseline" className="lg:col-span-2">
          {losses.length ? (
            <LossChart
              months={losses.slice(-12).map((l) => ({ yearMonth: l.yearMonth, stockout: l.stockoutLoss, overstock: l.overstockWriteoff }))}
              baselineLow={monthly.low} baselineHigh={monthly.high} limit={baseline.outcomeMonthlyLimit}
            />
          ) : (
            <Empty>
              No monthly figures yet. The baseline is {inr(monthly.low)}–{inr(monthly.high)} a month.{" "}
              <TextLink href="/tracker">Add finance’s numbers on the Tracker</TextLink>.
            </Empty>
          )}
        </Card>
        <div className="space-y-4">
          <KillSwitchPanel ks={ks} baseline={baseline} />
          <Card title="Payback">
            <div className="num text-2xl font-semibold">{ks.payback.months == null ? "—" : `${ks.payback.months.toFixed(1)} months`}</div>
            <div className="mt-1 text-sm text-[var(--text-2)]">
              {ks.payback.savingsPerMonth == null
                ? `Shows once a month of losses is entered (build cost ${inr(baseline.buildCost)}).`
                : ks.payback.savingsPerMonth > 0
                  ? `Saving ${inr(ks.payback.savingsPerMonth)} a month against the baseline.`
                  : `Not saving yet: losses average ${inr(ks.payback.avgLoss)} a month.`}
            </div>
          </Card>
        </div>
      </div>

      <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <summary className="cursor-pointer font-semibold">Before vs now, and recent runs</summary>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <table className="data">
            <thead><tr><th>Measure</th><th>Before</th><th>Now</th></tr></thead>
            <tbody>
              <tr><td>Planning cycle</td><td>Monthly</td><td>Twice a week</td></tr>
              <tr><td>Data age when ordering</td><td>3–4 weeks</td><td className="num">{avgAgeAtDecision == null ? "—" : `${avgAgeAtDecision.toFixed(1)} days`}</td></tr>
              <tr><td>Stockout lost sales</td><td>{inr(baseline.stockoutLossQuarterLow)}–{inr(baseline.stockoutLossQuarterHigh)}/qtr</td><td className="num">{losses.length ? `${inr(losses.slice(-3).reduce((s, l) => s + l.stockoutLoss, 0))} last ${Math.min(3, losses.length)} mo` : "—"}</td></tr>
              <tr><td>Overstock write-offs</td><td>{inr(baseline.overstockQuarterLow)}–{inr(baseline.overstockQuarterHigh)}/qtr</td><td className="num">{losses.length ? `${inr(losses.slice(-3).reduce((s, l) => s + l.overstockWriteoff, 0))} last ${Math.min(3, losses.length)} mo` : "—"}</td></tr>
              <tr><td>Raghav’s data work</td><td>~{baseline.plannerDaysPerMonth} days/month</td><td>Review queue only</td></tr>
            </tbody>
          </table>
          {runs.length ? (
            <table className="data">
              <thead><tr><th>Run</th><th>When</th><th className="r">Flagged</th><th>Status</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="num">#{r.id} <span className="text-[var(--text-3)]">{r.trigger}</span></td>
                    <td>{dateTimeLabel(r.startedAt)}</td>
                    <td className="r num">{(r.summary?.review ?? 0) + (r.summary?.exceptions ?? 0)}</td>
                    <td title={r.error ?? undefined}>{r.error ? `⚠ ${r.status}` : r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No runs yet.</Empty>}
        </div>
      </details>
    </>
  );
}

function ActionLink({ href, primary, children }: { href: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} prefetch={false}
      className={`rounded-lg px-4 py-2 text-sm font-medium ${primary ? "bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90" : "border border-[var(--border)] hover:bg-[var(--surface-2)]"}`}>
      {children} →
    </Link>
  );
}
