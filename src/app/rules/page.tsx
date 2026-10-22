import { requireUser } from "@/lib/auth";
import { getActiveRules } from "@/lib/settings";
import { diffConfig, rulesHistory } from "@/lib/decisions";
import { getDb } from "@/lib/db";
import { loadHistory, loadSkus } from "@/lib/rules/data";
import { Card, Notice, btnCls, inputCls } from "@/components/ui";
import { MONTHS } from "@/lib/ui/format";
import { saveRulesAction } from "../actions";

export const dynamic = "force-dynamic";

function Field({ label, name, value, step = 1, suffix }: { label: string; name: string; value: number; step?: number; suffix?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input name={name} type="number" step={step} min={0} required defaultValue={value} className={`${inputCls} w-24 text-right`} />
        {suffix && <span className="w-12 text-stone-500">{suffix}</span>}
      </span>
    </label>
  );
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const [{ version, config: c }, history, fileSkus, sales] = await Promise.all([getActiveRules(), rulesHistory(), loadSkus(db), loadHistory(db)]);
  const readOnly = user.role !== "planner";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Rules (v{version})</h1>
        <p className="text-sm text-stone-600">
          Raghav’s documented rules. Every change is saved as a new version with who and when, and applies from the next run.
        </p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}
      {readOnly && <Notice>You are signed in as a viewer: read-only.</Notice>}

      <form action={saveRulesAction}>
        <fieldset disabled={readOnly} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="1 · Festival uplift (applied first)">
              <div className="space-y-2">
                <Field label="Demand uplift" name="upliftPct" value={Math.round((c.festival.upliftMultiplier - 1) * 1000) / 10} step={0.5} suffix="%" />
                <div className="text-sm">Festival months</div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {MONTHS.map((m, i) => (
                    <label key={m} className="flex items-center gap-1">
                      <input type="checkbox" name="festivalMonths" value={i + 1} defaultChecked={c.festival.months.includes(i + 1)} />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
            </Card>
            <Card title="2 · High demand">
              <div className="space-y-2">
                <Field label={`Last ${c.highDemand.recentWeeks} wk above ${c.highDemand.baselineWeeks}-wk average by more than`} name="thresholdPct" value={c.highDemand.thresholdPct} suffix="%" />
                <Field label="Reorder at × standard order qty" name="orderMultiplier" value={c.highDemand.orderMultiplier} step={0.05} suffix="×" />
              </div>
            </Card>
            <Card title="3–5 · Weeks of cover">
              <div className="space-y-2">
                <Field label="Standard: stockout risk below" name="stdMin" value={c.cover.standard.minWeeks} step={0.5} suffix="weeks" />
                <Field label="Standard: overstock risk above" name="stdMax" value={c.cover.standard.maxWeeks} step={0.5} suffix="weeks" />
                <Field label="Perishable: stockout risk below" name="perMin" value={c.cover.perishable.minWeeks} step={0.5} suffix="weeks" />
                <Field label="Perishable: overstock risk above" name="perMax" value={c.cover.perishable.maxWeeks} step={0.5} suffix="weeks" />
              </div>
            </Card>
            <Card title="6 · Exceptions (to Raghav’s judgement)">
              <div className="space-y-2">
                <Field label="New SKU: fewer weeks of history than" name="minHistoryWeeks" value={c.exceptions.minHistoryWeeks} suffix="weeks" />
                <Field label="One distributor drives more than … of the WoW change" name="distributorConcentrationPct" value={c.exceptions.distributorConcentrationPct} suffix="%" />
                {!sales.hasDistributorDetail && (
                  <p className="text-xs text-amber-700">Off for now: the sales data has no distributor column. Switches on when it does.</p>
                )}
                <Field label="Week-on-week swing above" name="wowSwingPct" value={c.exceptions.wowSwingPct} suffix="%" />
              </div>
            </Card>
          </div>

          <Card title="Perishable list">
            <p className="mb-2 text-sm text-stone-600">Starts from the SKU file’s perishability flag. Override a SKU here; perishable SKUs use the tighter window.</p>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {fileSkus.map((s) => {
                const o = c.perishableOverrides[s.skuId];
                return (
                  <label key={s.skuId} className="flex items-center justify-between gap-2 border-b border-stone-100 py-1">
                    <span className="truncate">
                      <b>{s.skuId}</b> <span className="text-stone-500">{s.name}</span>
                    </span>
                    <select name={`perishable:${s.skuId}`} defaultValue={o === undefined ? "file" : o ? "yes" : "no"} className={inputCls}>
                      <option value="file">file: {s.isPerishable ? "perishable" : "no"}</option>
                      <option value="yes">perishable</option>
                      <option value="no">not perishable</option>
                    </select>
                  </label>
                );
              })}
            </div>
          </Card>

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <input name="note" required minLength={3} placeholder="Why are you changing the rules? (required)" className={`${inputCls} w-full max-w-md`} />
              <button className={btnCls}>Save as v{history[0]?.version + 1}</button>
            </div>
          )}
        </fieldset>
      </form>

      <Card title="Change history">
        <ol className="space-y-2 text-sm">
          {history.map((h, i) => {
            const prev = history[i + 1];
            const changes = prev ? diffConfig(prev.config, h.config) : [];
            return (
              <li key={h.version} className="border-t border-stone-100 pt-2">
                <b>v{h.version}</b> · {h.changedBy} · {h.changedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
                {h.note && <> — “{h.note}”</>}
                {changes.length > 0 && (
                  <ul className="ml-4 list-disc text-xs text-stone-600">
                    {changes.map((x) => <li key={x}><code>{x}</code></li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
