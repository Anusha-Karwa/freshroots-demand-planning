import { dataStatus } from "@/lib/data-status";
import { getBaseline } from "@/lib/settings";
import { monthlyLossBand } from "@/lib/config/baseline";

export const dynamic = "force-dynamic";

const lakh = (n: number) => `₹${(n / 100_000).toFixed(1)} L`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export default async function OverviewPage() {
  const [s, baseline] = await Promise.all([dataStatus(), getBaseline()]);
  const band = monthlyLossBand(baseline);
  const ageOk = s.dataAgeDays !== null && s.dataAgeDays <= baseline.targetDataAgeDays;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-stone-600">
          Outcome: ₹ losses from stockouts + overstock below {lakh(band.low)}–{lakh(band.high)} a month, on data no
          more than {baseline.targetDataAgeDays} days old.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Data age"
          value={s.dataAgeDays === null ? "No data" : `${s.dataAgeDays} days`}
          sub={s.dataAsOf ? `sales up to ${s.dataAsOf} · target ≤ ${baseline.targetDataAgeDays} days${ageOk ? "" : " ⚠"}` : "run npm run seed"}
        />
        <Tile label="SKUs" value={s.skus.toLocaleString("en-IN")} />
        <Tile label="Distributors" value={s.distributors.toLocaleString("en-IN")} />
        <Tile
          label="Sales history"
          value={`${s.weeks} weeks`}
          sub={s.first_week ? `${s.first_week} → ${s.last_week} · ${s.sales_rows.toLocaleString("en-IN")} rows` : undefined}
        />
      </section>

      <section className="rounded border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Baseline (pre-build)</h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-stone-500">Stockout losses / quarter</dt>
          <dd>{lakh(baseline.stockoutLossPerQuarter.low)} – {lakh(baseline.stockoutLossPerQuarter.high)}</dd>
          <dt className="text-stone-500">Overstock write-offs / quarter</dt>
          <dd>{lakh(baseline.overstockWriteoffPerQuarter.low)} – {lakh(baseline.overstockWriteoffPerQuarter.high)}</dd>
          <dt className="text-stone-500">Data age at decision</dt>
          <dd>{baseline.dataAgeWeeks.low}–{baseline.dataAgeWeeks.high} weeks</dd>
          <dt className="text-stone-500">Planning cycle / planner effort</dt>
          <dd>{baseline.planningCycle}, ~{baseline.plannerDaysPerMonth} days/month</dd>
        </dl>
      </section>

      <section className="rounded border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Recent data loads</h2>
        {s.loads.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing loaded yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 pr-3">File</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3 text-right">Accepted</th>
                  <th className="py-1 pr-3 text-right">Rejected</th>
                  <th className="py-1 pr-3">Data as of</th>
                </tr>
              </thead>
              <tbody>
                {s.loads.map((l) => (
                  <tr key={l.id} className="border-t border-stone-100">
                    <td className="py-1 pr-3 font-mono text-xs">{l.fileName}</td>
                    <td className="py-1 pr-3">{l.fileType}</td>
                    <td className="py-1 pr-3 text-right">{l.rowsAccepted.toLocaleString("en-IN")}</td>
                    <td className={`py-1 pr-3 text-right ${l.rowsRejected ? "text-red-700" : ""}`}>{l.rowsRejected}</td>
                    <td className="py-1 pr-3">{l.dataAsOf ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
