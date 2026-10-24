import { desc, eq, inArray, max } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { addDays, todayIst } from "@/lib/dates";
import { dateLabel, dateTimeLabel, inr, monthLabel, num, pct } from "@/lib/format";
import { overridesByRun } from "@/lib/killswitch";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { getBaseline } from "@/lib/settings";
import { Badge, Button, Card, Empty, Flash, PageHeader, Stat } from "@/components/ui";
import { addIncident, deleteMonthlyLoss, runTrackerNow, saveMonthlyLoss } from "../../actions";

const STATUS: Record<string, { tone: "good" | "warn" | "bad" | "info"; label: string }> = {
  on_track: { tone: "good", label: "On track" },
  above: { tone: "info", label: "Selling faster" },
  below: { tone: "warn", label: "Selling slower" },
  stockout: { tone: "bad", label: "Out of stock" },
};

export default async function TrackerPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const planner = session.role === "planner";
  const baseline = await getBaseline(db);

  const [lastCheck] = await db.select({ d: max(schema.trackerChecks.checkDate) }).from(schema.trackerChecks);
  const checks = lastCheck?.d
    ? await db.select({ c: schema.trackerChecks, name: schema.skus.name }).from(schema.trackerChecks)
      .innerJoin(schema.skus, eq(schema.skus.id, schema.trackerChecks.skuId))
      .where(eq(schema.trackerChecks.checkDate, lastCheck.d)).orderBy(schema.trackerChecks.skuId)
    : [];
  const [incidents, overrides, runOverrides, losses, pos, skus] = await Promise.all([
    db.select().from(schema.stockoutIncidents).orderBy(desc(schema.stockoutIncidents.weekStart)).limit(100),
    db.select().from(schema.decisionLog).where(inArray(schema.decisionLog.decision, ["edited", "rejected"])).orderBy(desc(schema.decisionLog.id)).limit(30),
    overridesByRun(db),
    db.select().from(schema.monthlyLosses).orderBy(desc(schema.monthlyLosses.yearMonth)),
    db.select({ age: schema.purchaseOrders.dataAgeDays }).from(schema.purchaseOrders),
    db.select({ id: schema.skus.id, name: schema.skus.name }).from(schema.skus).orderBy(schema.skus.id),
  ]);

  const off = checks.filter((c) => c.c.status !== "on_track").length;
  const byStatus = (s: string) => checks.filter((c) => c.c.status === s).length;
  const incidentsBySku = new Map<string, number>();
  for (const i of incidents) incidentsBySku.set(i.skuId, (incidentsBySku.get(i.skuId) ?? 0) + 1);
  const totalDecided = runOverrides.reduce((s, r) => s + r.decided, 0);
  const totalOverridden = runOverrides.reduce((s, r) => s + r.overridden, 0);
  const poAges = pos.filter((p) => p.age != null).map((p) => p.age!);
  const lastMonth = addDays(todayIst(), -15).slice(0, 7);

  return (
    <>
      <PageHeader
        title="Tracker"
        subtitle={`Measurement plan: the daily early warning (actual sales vs forecast per SKU), stockouts, Raghav’s overrides with reasons, data age at PO time, and the primary outcome — monthly ₹ losses vs baseline. Variance beyond ±${baseline.trackerVariancePct}% is flagged.`}
        actions={planner && <form action={runTrackerNow}><Button variant="secondary">Run daily check now</Button></form>}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Off forecast" value={`${off} of ${checks.length}`} sub={lastCheck?.d ? `Check of ${dateLabel(lastCheck.d)}` : "No check yet"} tone={off ? "warn" : checks.length ? "good" : undefined} />
        <Stat label="Out of stock now" value={byStatus("stockout")} tone={byStatus("stockout") ? "bad" : undefined} sub={`${incidents.length} stockout incident(s) logged`} />
        <Stat label="Override rate" value={totalDecided ? pct((totalOverridden / totalDecided) * 100, false) : "—"} sub={`${totalOverridden} edited/rejected of ${totalDecided} decided`} />
        <Stat label="Data age at PO" value={poAges.length ? `${(poAges.reduce((a, b) => a + b, 0) / poAges.length).toFixed(1)} days` : "—"} sub={`Target ≤ ${baseline.dataAgeTargetDays} days (was 3–4 weeks)`} tone={poAges.length ? (Math.max(...poAges) <= baseline.dataAgeTargetDays ? "good" : "warn") : undefined} />
      </div>

      <Card title="Early warning: actual vs forecast" className="mb-4">
        {checks.length === 0 ? <Empty>The daily check runs at 07:00 IST.{planner && " Or run it now (top right)."}</Empty> : (
          <div className="overflow-x-auto">
            <p className="mb-2 text-xs text-[var(--text-2)]">Week of {dateLabel(checks[0].c.weekStart)} — SAP sales arrive weekly, so these move when a new week is loaded.</p>
            <table className="data">
              <thead><tr><th>SKU</th><th className="r">Actual</th><th className="r">Forecast</th><th className="r">Variance</th><th className="r">Stock</th><th className="r">Cover</th><th>Status</th><th className="r">Stockouts (all time)</th></tr></thead>
              <tbody>
                {checks.map(({ c, name }) => (
                  <tr key={c.skuId}>
                    <td>{c.skuId} <span className="text-xs text-[var(--text-2)]">{name}</span></td>
                    <td className="r num">{num(c.actualUnits)}</td>
                    <td className="r num">{num(c.forecastUnits, 1)}</td>
                    <td className="r num">{pct(c.variancePct)}</td>
                    <td className="r num">{num(c.stockUnits)}</td>
                    <td className="r num">{c.weeksCover == null ? "—" : `${num(c.weeksCover, 1)} wk`}</td>
                    <td><Badge tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label ?? c.status}</Badge></td>
                    <td className="r num">{incidentsBySku.get(c.skuId) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Monthly ₹ losses (primary outcome)">
          {planner && (
            <form action={saveMonthlyLoss} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="text-xs text-[var(--text-2)]">Month<input type="month" name="yearMonth" defaultValue={lastMonth} required className="mt-1 w-full" /></label>
              <label className="text-xs text-[var(--text-2)]">Stockout lost sales (₹)<input name="stockoutLoss" inputMode="numeric" required placeholder="e.g. 520000" className="num mt-1 w-full" /></label>
              <label className="text-xs text-[var(--text-2)]">Overstock write-offs (₹)<input name="overstockWriteoff" inputMode="numeric" required placeholder="e.g. 310000" className="num mt-1 w-full" /></label>
              <label className="text-xs text-[var(--text-2)]">Distributor complaints<input name="distributorComplaints" type="number" min={0} className="num mt-1 w-full" /></label>
              <label className="col-span-2 text-xs text-[var(--text-2)]">Note<input name="note" placeholder="Source: finance close" className="mt-1 w-full" /></label>
              <div className="col-span-full"><Button>Save month</Button></div>
            </form>
          )}
          {losses.length === 0 ? <Empty>No months entered yet.</Empty> : (
            <table className="data">
              <thead><tr><th>Month</th><th className="r">Stockouts</th><th className="r">Overstock</th><th className="r">Total</th><th className="r">Complaints</th><th></th></tr></thead>
              <tbody>
                {losses.map((l) => {
                  const total = l.stockoutLoss + l.overstockWriteoff;
                  return (
                    <tr key={l.yearMonth}>
                      <td>{monthLabel(l.yearMonth)}<div className="text-xs text-[var(--text-3)]">{l.enteredBy}{l.note ? ` · ${l.note}` : ""}</div></td>
                      <td className="r num">{inr(l.stockoutLoss)}</td>
                      <td className="r num">{inr(l.overstockWriteoff)}</td>
                      <td className="r num font-semibold">{inr(total)} {total > baseline.outcomeMonthlyLimit && <Badge tone="bad">over limit</Badge>}</td>
                      <td className="r num">{num(l.distributorComplaints)}</td>
                      <td>{planner && <form action={deleteMonthlyLoss}><input type="hidden" name="yearMonth" value={l.yearMonth} /><button className="text-xs text-[var(--text-3)] underline">remove</button></form>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Override log (edits & rejections)">
          {overrides.length === 0 ? <Empty>No edits or rejections yet.</Empty> : (
            <table className="data">
              <thead><tr><th>When</th><th>SKU</th><th>Decision</th><th className="r">Rule → final</th><th>Reason</th></tr></thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap text-xs">{dateTimeLabel(o.createdAt)}<div className="text-[var(--text-3)]">{o.decidedBy} · run #{o.runId}</div></td>
                    <td>{o.skuId}</td>
                    <td><Badge tone={o.decision === "rejected" ? "bad" : "info"}>{o.decision}</Badge></td>
                    <td className="r num">{num(o.recommendedQty)} → {num(o.finalQty)}</td>
                    <td className="text-xs">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {runOverrides.length > 0 && (
            <p className="mt-3 text-xs text-[var(--text-2)]">
              By run: {runOverrides.slice(0, 8).map((r) => `#${r.runId} ${Math.round((r.overridden / r.decided) * 100)}%`).join(" · ")}
            </p>
          )}
        </Card>
      </div>

      <Card title="Stockout incidents">
        {planner && (
          <form action={addIncident} className="mb-4 flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--text-2)]">SKU
              <select name="skuId" required className="mt-1 block">{skus.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</select>
            </label>
            <label className="text-xs text-[var(--text-2)]">Week starting<input type="date" name="weekStart" required className="mt-1 block" /></label>
            <label className="text-xs text-[var(--text-2)]">Lost units<input name="lostUnits" type="number" min={0} className="num mt-1 block w-24" /></label>
            <label className="text-xs text-[var(--text-2)]">Lost value (₹)<input name="lostValue" inputMode="numeric" className="num mt-1 block w-28" /></label>
            <label className="text-xs text-[var(--text-2)]">Note<input name="note" className="mt-1 block" /></label>
            <Button variant="secondary">Add incident</Button>
          </form>
        )}
        {incidents.length === 0 ? <Empty>No stockouts recorded. The daily check logs one when a SKU with demand reaches 0 stock.</Empty> : (
          <table className="data">
            <thead><tr><th>Week</th><th>SKU</th><th>Source</th><th className="r">Lost units</th><th className="r">Lost value (est.)</th><th>Note</th></tr></thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td>{dateLabel(i.weekStart)}</td><td>{i.skuId}</td><td>{i.source}</td>
                  <td className="r num">{num(i.lostUnits)}</td><td className="r num">{inr(i.lostValue)}</td><td className="text-xs">{i.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
