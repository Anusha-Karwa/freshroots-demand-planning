import { getDb } from "@/lib/db";
import { getActiveRules } from "@/lib/settings";
import { loadHistory, loadSkus, loadStockSnapshots } from "@/lib/rules/data";
import { runBacktest, type Confusion } from "@/lib/rules/backtest";
import { MONTHS, num, rupees } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "";
  return (
    <div className="rounded border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

const ConfusionLine = ({ c }: { c: Confusion }) => (
  <span>
    {c.tp} flagged &amp; happened · {c.fp} flagged, didn’t happen · {c.fn} missed · {c.tn} correctly not flagged
  </span>
);

export default async function BacktestPage() {
  const db = await getDb();
  const [history, skus, snapshots, rules] = await Promise.all([loadHistory(db), loadSkus(db), loadStockSnapshots(db), getActiveRules()]);
  if (!history.weeks.length) return <p className="text-sm text-stone-500">No sales data loaded yet — run <code>npm run seed</code>.</p>;
  const r = runBacktest(history, skus, rules.config, snapshots);
  const hd = r.highDemand;
  const f = r.forecast;
  const target = r.raghav.targetPct;
  const exceptionsAtCutoff = r.rows.filter((x) => x.exception);
  const estimated = f.placeholderPrices ? " (estimated — placeholder prices)" : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Backtest</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Replays Raghav’s rules (v{rules.version}) at {r.cutoffs.length} past cutoff weeks ({r.cutoffs[0]} → {r.cutoffs.at(-1)}) and
          compares each call with what actually sold over the next {r.options.horizonWeeks} weeks. Sales history: {r.weeks.count} weeks,{" "}
          {r.weeks.first} → {r.weeks.last}. Each cutoff needs {rules.config.highDemand.baselineWeeks} weeks of history before it, so a
          short history gives few cutoffs.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="High-demand calls vs outcome"
          value={hd.agreementPct === null ? "—" : `${hd.agreementPct}%`}
          tone={hd.agreementPct !== null && hd.agreementPct >= target ? "good" : "bad"}
          sub={<>target ≥ {target}% · {hd.n} rule-covered SKU-weeks<br /><ConfusionLine c={hd} /></>}
        />
        <Tile
          label="Sent to Raghav’s exceptions queue"
          value={`${exceptionsAtCutoff.length}`}
          sub={exceptionsAtCutoff.map((x) => `${x.skuId} on ${x.cutoff}`).join(", ") || "none"}
        />
        <Tile
          label="Forecast error: fresh vs monthly"
          value={f.freshWapePct === null ? "—" : `${f.freshWapePct}% vs ${f.staleWapePct}%`}
          tone={f.freshWapePct !== null && f.staleWapePct !== null ? (f.freshWapePct <= f.staleWapePct ? "good" : "bad") : undefined}
          sub={`weighted abs. error over ${f.n} SKU-weeks; monthly = data ${r.options.staleLagWeeks} weeks older`}
        />
        <Tile
          label={`Simulated ₹ impact${f.placeholderPrices ? " (est.)" : ""}`}
          value={rupees(f.savings)}
          tone={f.savings >= 0 ? "good" : "bad"}
          sub={`fresh − monthly lost sales + excess stock over the replayed weeks${estimated}`}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-stone-200 bg-white p-4 text-sm">
          <h2 className="font-medium">₹ breakdown{estimated}</h2>
          <table className="mt-2 w-full">
            <thead className="text-left text-stone-500">
              <tr><th className="py-1"></th><th className="py-1 text-right">Lost sales</th><th className="py-1 text-right">Excess stock</th><th className="py-1 text-right">Total</th></tr>
            </thead>
            <tbody>
              {(
                [
                  ["Twice-weekly (fresh data)", f.fresh],
                  [`Monthly (data ${r.options.staleLagWeeks} wk old)`, f.stale],
                ] as const
              ).map(([label, v]) => (
                <tr key={label} className="border-t border-stone-100">
                  <td className="py-1">{label}</td>
                  <td className="py-1 text-right">{rupees(v.lostSales)}</td>
                  <td className="py-1 text-right">{rupees(v.excess)}</td>
                  <td className="py-1 text-right font-medium">{rupees(v.lostSales + v.excess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">
            If stock were planned to exactly the forecast: units under forecast are lost sales (× unit price), units over are excess
            stock (× unit cost).
          </p>
        </div>
        <div className="space-y-3 rounded border border-stone-200 bg-white p-4 text-sm">
          <div>
            <h2 className="font-medium">Stockout / overstock flags</h2>
            {r.stockFlags.available ? (
              <p className="mt-1 text-stone-600">
                Stockout: {r.stockFlags.stockout.agreementPct}% (<ConfusionLine c={r.stockFlags.stockout} />). Overstock:{" "}
                {r.stockFlags.overstock.agreementPct}% (<ConfusionLine c={r.stockFlags.overstock} />).
              </p>
            ) : (
              <p className="mt-1 text-stone-600">
                Not replayable yet: the seed data has a single stock snapshot, so stock at past cutoffs is unknown. Load weekly stock
                snapshots (SAP export) and these flags are checked automatically.
              </p>
            )}
          </div>
          <div>
            <h2 className="font-medium">Agreement with Raghav’s past calls</h2>
            <p className="mt-1 text-stone-600">
              Not available: Raghav’s historical recommendations aren’t in the seed data. Target once loaded: ≥ {target}% agreement on
              rule-covered SKUs. Until then the backtest compares the rules with what actually sold.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded border border-stone-200 bg-white">
        <h2 className="px-4 pt-4 font-medium">Every replayed call</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-500">
              <tr>
                <th className="px-3 py-2">Cutoff</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Planned month</th>
                <th className="px-3 py-2 text-right">12-wk avg</th>
                <th className="px-3 py-2 text-right">Forecast (fresh)</th>
                <th className="px-3 py-2 text-right">Forecast (monthly)</th>
                <th className="px-3 py-2 text-right">Actual avg</th>
                <th className="px-3 py-2">High demand: rule → actual</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => {
                const right = x.predictedHigh === x.actualHigh;
                return (
                  <tr key={`${x.cutoff}-${x.skuId}`} className="border-t border-stone-100">
                    <td className="px-3 py-1.5 whitespace-nowrap">{x.cutoff}</td>
                    <td className="px-3 py-1.5">{x.skuId}</td>
                    <td className="px-3 py-1.5">
                      {MONTHS[x.planningMonth - 1]}
                      {rules.config.festival.months.includes(x.planningMonth) && <span className="ml-1 text-xs text-amber-700">festival</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">{num(x.avg12, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{num(x.freshForecast, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{x.staleForecast === null ? "—" : num(x.staleForecast, 1)}</td>
                    <td className="px-3 py-1.5 text-right">{num(x.actualAvg, 1)} <span className="text-xs text-stone-400">({x.outcomeWeeks} wk)</span></td>
                    <td className="px-3 py-1.5">
                      {x.exception ? (
                        <span className="text-amber-700">exception → Raghav{x.actualHigh ? " (demand did rise)" : ""}</span>
                      ) : (
                        <span className={right ? "text-stone-600" : "font-medium text-red-700"}>
                          {x.predictedHigh ? "flag" : "no flag"} → {x.actualHigh ? "rose > " + rules.config.highDemand.thresholdPct + "%" : "steady"} {right ? "✓" : "✗"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
