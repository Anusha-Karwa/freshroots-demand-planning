import { requireUser } from "@/lib/auth";
import { getBaseline } from "@/lib/settings";
import { monthlyLossBand } from "@/lib/config/baseline";
import { killSwitch } from "@/lib/killswitch";
import {
  TRACKER_ALERT_PCT, complaints, decisionDataAge, decisionsByRun, incidents, latestTracker, monthlyLossRows,
  overrideLog, stockoutFrequency, toMonthLoss, todayIST,
} from "@/lib/tracker";
import { Card, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { KillSwitchPanel } from "@/components/KillSwitchPanel";
import { LossChart } from "@/components/LossChart";
import { num, rupees } from "@/lib/ui/format";
import { addComplaint, addIncident, refreshTracker, saveMonthlyLoss } from "../actions";

export const dynamic = "force-dynamic";

export default async function TrackerPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const planner = user.role === "planner";
  const [tracker, baseline, runs, lossRows, overrides, age, inc, freq, comp] = await Promise.all([
    latestTracker(), getBaseline(), decisionsByRun(), monthlyLossRows(), overrideLog(), decisionDataAge(), incidents(), stockoutFrequency(), complaints(),
  ]);
  const months = toMonthLoss(lossRows);
  const k = killSwitch(runs, months, baseline);
  const band = monthlyLossBand(baseline);
  const alerts = tracker.rows.filter((r) => r.deviationPct !== null && Math.abs(r.deviationPct) > TRACKER_ALERT_PCT);
  const placeholderPrice = inc.some((i) => i.note?.includes("placeholder"));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tracker</h1>
        <p className="text-sm text-stone-600">
          Measuring the outcome: ₹ losses vs baseline (primary), actual sales vs forecast (daily early warning), stockouts, Raghav’s
          overrides, data age at decision and distributor complaints.
        </p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <KillSwitchPanel k={k} />

      <Card title="Monthly ₹ losses vs baseline (primary metric)">
        <LossChart data={lossRows.map((r) => ({ month: r.month, stockout: r.stockoutLoss, overstock: r.overstockWriteoff }))} band={band} limit={baseline.killSwitch.monthlyLossLimit} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr><th className="py-1 pr-3">Month</th><th className="py-1 pr-3 text-right">Stockout lost sales</th><th className="py-1 pr-3 text-right">Overstock write-offs</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1">Notes</th></tr>
            </thead>
            <tbody>
              {lossRows.map((r) => (
                <tr key={r.month} className="border-t border-stone-100">
                  <td className="py-1 pr-3">{r.month}</td>
                  <td className="py-1 pr-3 text-right">{rupees(r.stockoutLoss)}</td>
                  <td className="py-1 pr-3 text-right">{rupees(r.overstockWriteoff)}</td>
                  <td className={`py-1 pr-3 text-right font-medium ${r.stockoutLoss + r.overstockWriteoff > baseline.killSwitch.monthlyLossLimit ? "text-red-700" : ""}`}>{rupees(r.stockoutLoss + r.overstockWriteoff)}</td>
                  <td className="py-1 text-xs text-stone-500">{r.notes} {r.enteredBy && `— ${r.enteredBy}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {planner && (
          <form action={saveMonthlyLoss} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <label>Month<br /><input type="month" name="month" required className={inputCls} /></label>
            <label>Stockout lost sales (₹)<br /><input name="stockoutLoss" inputMode="numeric" required placeholder="e.g. 520000" className={`${inputCls} w-36`} /></label>
            <label>Overstock write-offs (₹)<br /><input name="overstockWriteoff" inputMode="numeric" required placeholder="e.g. 310000" className={`${inputCls} w-36`} /></label>
            <label className="grow">Notes<br /><input name="notes" placeholder="source, e.g. finance close" className={`${inputCls} w-full`} /></label>
            <button className={btnCls}>Save month</button>
          </form>
        )}
      </Card>

      <Card
        title={`Actual vs forecast${tracker.rows[0] ? ` — week of ${tracker.rows[0].week}` : ""} (early warning)`}
        right={planner && <form action={refreshTracker}><button className={btnGhostCls}>Refresh now</button></form>}
      >
        {!tracker.date ? (
          <p className="text-sm text-stone-500">Not computed yet. It runs daily at 07:00 IST, or press Refresh now.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-stone-600">
              Computed {tracker.date}. {alerts.length} SKU(s) sold more than {TRACKER_ALERT_PCT}% off forecast. Sales arrive weekly, so
              these numbers change when a new week of SAP data is loaded.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-stone-500">
                  <tr><th className="py-1 pr-3">SKU</th><th className="py-1 pr-3 text-right">Forecast</th><th className="py-1 pr-3 text-right">Actual</th><th className="py-1 pr-3 text-right">Off by</th><th className="py-1 pr-3 text-right">Stock now</th><th className="py-1">Forecast from</th></tr>
                </thead>
                <tbody>
                  {tracker.rows.map((r) => {
                    const off = r.deviationPct !== null && Math.abs(r.deviationPct) > TRACKER_ALERT_PCT;
                    return (
                      <tr key={r.skuId} className="border-t border-stone-100">
                        <td className="py-1 pr-3"><b>{r.skuId}</b> <span className="text-xs text-stone-500">{r.name}</span></td>
                        <td className="py-1 pr-3 text-right">{num(r.forecastUnits, 1)}</td>
                        <td className="py-1 pr-3 text-right">{num(r.actualUnits)}</td>
                        <td className={`py-1 pr-3 text-right ${off ? "font-medium text-red-700" : ""}`}>{r.deviationPct === null ? "—" : `${r.deviationPct > 0 ? "+" : ""}${num(r.deviationPct, 1)}%`}{off && " ⚠"}</td>
                        <td className="py-1 pr-3 text-right">{r.stockOnHand === null ? "—" : num(r.stockOnHand)}</td>
                        <td className="py-1 text-xs text-stone-500">{r.forecastSource === "run" ? "saved run" : "rules re-run on history"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Raghav’s overrides (edits and rejections)">
          <p className="mb-2 text-xs text-stone-500">
            Data age at decision: {age.avg === null ? "no decisions yet" : `${num(age.avg, 1)} days on average, ${age.max} at most`} (target ≤ {baseline.targetDataAgeDays}; was 21–28).
          </p>
          {overrides.length === 0 ? (
            <p className="text-sm text-stone-500">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {overrides.map((o) => (
                <li key={o.id} className="border-t border-stone-100 pt-1">
                  <b>{o.skuId}</b> run #{o.runId}: {o.status === "rejected" ? "rejected" : `${num(o.recommendedQty)} → ${num(o.finalQty ?? 0)}`} — “{o.decisionReason}”
                  <span className="text-xs text-stone-400"> {o.decidedBy}{o.dataAgeDays !== null && `, data ${o.dataAgeDays} days old`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Stockout incidents">
          {freq.length > 0 && <p className="mb-2 text-xs text-stone-500">Most frequent: {freq.map((f) => `${f.sku_id} ×${f.n}`).join(", ")}</p>}
          {inc.length === 0 ? (
            <p className="text-sm text-stone-500">None recorded. Detected automatically when a selling SKU’s stock is 0.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {inc.map((i) => (
                <li key={i.id} className="border-t border-stone-100 pt-1">
                  {i.date} <b>{i.skuId}</b> · {i.source}{i.estLostUnits != null && ` · ~${num(i.estLostUnits)} units`}{i.estLostValue != null && ` · ${rupees(i.estLostValue)}${placeholderPrice ? " (est.)" : ""}`}
                  {i.note && <span className="text-xs text-stone-500"> — {i.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {planner && (
            <form action={addIncident} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
              <input type="date" name="date" required defaultValue={todayIST()} className={inputCls} />
              <input name="skuId" required placeholder="SKU" className={`${inputCls} w-24`} />
              <input name="units" type="number" min={0} placeholder="lost units" className={`${inputCls} w-24`} />
              <input name="note" placeholder="note" className={`${inputCls} grow`} />
              <button className={btnGhostCls}>Add</button>
            </form>
          )}
        </Card>
      </div>

      <Card title="Distributor complaints">
        {comp.length === 0 ? (
          <p className="text-sm text-stone-500">None recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {comp.map((c) => (
              <li key={c.id} className="border-t border-stone-100 pt-1">
                {c.date} {c.distributorId && <b>{c.distributorId}</b>} {c.skuId && <>· {c.skuId}</>} — {c.note} <span className="text-xs text-stone-400">{c.enteredBy}</span>
              </li>
            ))}
          </ul>
        )}
        {planner && (
          <form action={addComplaint} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <input type="date" name="date" required defaultValue={todayIST()} className={inputCls} />
            <input name="distributorId" placeholder="Distributor" className={`${inputCls} w-28`} />
            <input name="skuId" placeholder="SKU" className={`${inputCls} w-24`} />
            <input name="note" required minLength={3} placeholder="What happened" className={`${inputCls} grow`} />
            <button className={btnGhostCls}>Add</button>
          </form>
        )}
      </Card>
    </div>
  );
}
