import { runBacktest } from "@/lib/backtest";
import { dateLabel, inr, num, pct } from "@/lib/format";
import { pageDb } from "@/lib/page";
import { Badge, Card, Empty, PageHeader, Stat, TextLink } from "@/components/ui";

export default async function BacktestPage() {
  const db = await pageDb();
  const r = await runBacktest(db);
  const est = r.placeholderPrices ? " (estimated: placeholder prices)" : "";

  return (
    <>
      <PageHeader
        title="Backtest"
        subtitle={<>Replays the rules (current version) on the loaded history, week by week, and checks them against what actually sold next. No AI is involved. Target: ≥ 85% agreement on rule-covered SKUs.</>}
      />
      {r.points === 0 ? (
        <Empty>Not enough history: the rules need {12} weeks before the first replayed week, plus at least one later week. <TextLink href="/data">Load more weeks</TextLink>.</Empty>
      ) : (
        <>
          <p className="mb-4 text-[var(--text-2)]">
            {r.weeksReplayed.length} as-of week(s) replayed ({dateLabel(r.weeksReplayed[0])} → {dateLabel(r.weeksReplayed[r.weeksReplayed.length - 1])}), {r.points} SKU-weeks. Each one only sees data up to that week.
          </p>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Agreement with Raghav"
              value={r.agreement?.pct != null ? pct(r.agreement.pct, false) : "—"}
              tone={r.agreement?.pct != null ? (r.agreement.pct >= 85 ? "good" : "warn") : undefined}
              sub={r.agreement ? `${r.agreement.agreed} of ${r.agreement.compared} SKU-weeks match (target ≥ 85%)` : "Upload Raghav’s past recommendations on the Data page to measure this"}
            />
            <Stat
              label="High-demand calls right"
              value={r.highDemand.accuracyPct != null ? pct(r.highDemand.accuracyPct, false) : "—"}
              tone={r.highDemand.accuracyPct != null ? (r.highDemand.accuracyPct >= 85 ? "good" : "warn") : undefined}
              sub={`Flag (or no flag) matched the next ${4} weeks · ${r.highDemand.confirmed}/${r.highDemand.flagged} flags confirmed, ${r.highDemand.missed} missed`}
            />
            <Stat
              label="Forecast error (MAPE)"
              value={<span>{pct(r.forecast.freshMapePct, false)} <span className="text-base text-[var(--text-3)]">vs {pct(r.forecast.monthlyMapePct, false)}</span></span>}
              sub={`Twice-weekly (fresh data) vs monthly cycle (data ${r.monthlyLagWeeks} weeks older)`}
            />
            <Stat
              label="Simulated impact of fresh data"
              value={inr(r.forecast.savingsPerMonth)}
              tone={r.forecast.savingsPerMonth > 0 ? "good" : "warn"}
              sub={`per month${est}: forecast-error cost ${inr(r.forecast.monthlyCost)} → ${inr(r.forecast.freshCost)} over the replay`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Per SKU" className="lg:col-span-2">
              <div className="overflow-x-auto">
                <table className="data">
                  <thead><tr><th>SKU</th><th className="r">High-demand weeks flagged</th><th className="r">…confirmed</th><th className="r">Avg error, fresh (units/wk)</th><th className="r">Avg error, monthly (units/wk)</th></tr></thead>
                  <tbody>
                    {r.perSku.map((s) => (
                      <tr key={s.skuId}>
                        <td>{s.skuId} <span className="text-xs text-[var(--text-2)]">{s.name}</span></td>
                        <td className="r num">{s.flaggedWeeks}</td>
                        <td className="r num">{s.confirmedWeeks}</td>
                        <td className="r num">{num(s.freshErr, 1)}</td>
                        <td className="r num whitespace-nowrap">{num(s.monthlyErr, 1)} {s.monthlyErr > s.freshErr * 1.2 && <Badge tone="info">fresh helps</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="How to read this">
              <ul className="list-disc space-y-2 pl-5 text-xs text-[var(--text-2)]">
                <li><b>High-demand calls</b>: a flag is confirmed when the following 4 weeks really averaged more than the threshold above the 12-week average. A miss is a jump the rules didn’t flag.</li>
                <li><b>Forecast error cost</b>: units under-forecast × unit price (lost-sales risk) + units over-forecast × unit cost (overstock risk), for each replayed week.{est}</li>
                <li><b>Stock flags</b> (stockout/overstock) need the stock level at each past week. Only one stock snapshot is loaded, so they are replayed only where a snapshot exists. Upload weekly stock snapshots to replay them.</li>
                <li><b>Agreement with Raghav</b> needs his past flags (Data page → “Raghav’s past recommendations”). Without them the backtest compares the rules with what actually happened, as above.</li>
                {r.agreement && (
                  <li>By flag: {Object.entries(r.agreement.byFlag).map(([f, v]) => `${f} ${v.agreed}/${v.total}`).join(", ")}</li>
                )}
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
