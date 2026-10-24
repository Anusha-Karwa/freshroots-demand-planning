import { desc } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { dateTimeLabel } from "@/lib/format";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { DEFAULT_RULES, withDefaults, type RulesConfig } from "@/lib/rules/config";
import { getBaseline, getRules } from "@/lib/settings";
import { Badge, Button, Card, Flash, PageHeader } from "@/components/ui";
import { saveBaseline, saveRules } from "../../actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type NumKey = { [K in keyof RulesConfig]: RulesConfig[K] extends number ? K : never }[keyof RulesConfig];

const SECTIONS: { title: string; rule: string; fields: { key: NumKey; label: string; unit: string; step?: string }[] }[] = [
  { title: "1 · Festival uplift", rule: "In festival months, multiply expected demand before any threshold check.", fields: [{ key: "festivalUpliftPct", label: "Uplift", unit: "%" }] },
  {
    title: "2 · High demand", rule: "Last N weeks more than X% above the M-week average → reorder at a multiple of the standard quantity.",
    fields: [
      { key: "highDemandPct", label: "More than", unit: "% above" },
      { key: "highDemandOrderMultiplier", label: "Order", unit: "× standard qty", step: "0.05" },
      { key: "shortWindowWeeks", label: "Recent window", unit: "weeks" },
      { key: "longWindowWeeks", label: "Average window", unit: "weeks" },
    ],
  },
  {
    title: "3–4 · Stock cover", rule: "Stock below the minimum → stockout risk (reorder now). Above the maximum → overstock risk (pause the next order).",
    fields: [
      { key: "minCoverWeeks", label: "Minimum", unit: "weeks of sales", step: "0.5" },
      { key: "maxCoverWeeks", label: "Maximum", unit: "weeks of sales", step: "0.5" },
    ],
  },
  {
    title: "5 · Perishable SKUs", rule: "High-perishability SKUs use tighter windows.",
    fields: [
      { key: "perishableMinCoverWeeks", label: "Minimum", unit: "weeks", step: "0.5" },
      { key: "perishableMaxCoverWeeks", label: "Maximum", unit: "weeks", step: "0.5" },
    ],
  },
  {
    title: "6 · Exceptions (your judgement)", rule: "These go to the Exceptions queue instead of getting a rule quantity.",
    fields: [
      { key: "newSkuMinWeeks", label: "New SKU: fewer than", unit: "weeks of history" },
      { key: "wowSwingPct", label: "Week-on-week swing above", unit: "%" },
      { key: "distributorSharePct", label: "One distributor drives more than", unit: "% of the change" },
      { key: "distributorMinChangePct", label: "…only when the total change is at least", unit: "% (ignores noise)" },
    ],
  },
];

function diff(prev: RulesConfig | null, next: RulesConfig) {
  if (!prev) return ["Initial version"];
  const out: string[] = [];
  for (const k of Object.keys(next) as (keyof RulesConfig)[]) {
    const a = JSON.stringify(prev[k]);
    const b = JSON.stringify(next[k]);
    if (a !== b) out.push(`${k}: ${a} → ${b}`);
  }
  return out.length ? out : ["No change"];
}

export default async function RulesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const planner = session.role === "planner";
  const rules = await getRules(db);
  const cfg = rules.config;
  const [versions, skus, baseline] = await Promise.all([
    db.select().from(schema.rulesVersions).orderBy(desc(schema.rulesVersions.id)).limit(20),
    db.select().from(schema.skus).orderBy(schema.skus.id),
    getBaseline(db),
  ]);
  const lakh = (x: number) => x / 100_000;

  return (
    <>
      <PageHeader
        title="Rules config"
        subtitle={<>Raghav’s documented forecasting rules as editable numbers. Every change is saved as a new version with who, when and why; the next run uses the latest version. In force: <b>version {rules.id}</b> by {rules.createdBy}, {dateTimeLabel(rules.createdAt)}.</>}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      <form action={saveRules}>
        <fieldset disabled={!planner} className="grid gap-4 lg:grid-cols-2">
          <Card title="1 · Festival months">
            <div className="flex flex-wrap gap-3">
              {MONTHS.map((m, i) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input type="checkbox" name="festivalMonths" value={i + 1} defaultChecked={cfg.festivalMonths.includes(i + 1)} /> {m}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--text-3)]">Default: Mar, Oct, Nov.</p>
          </Card>
          {SECTIONS.map((s) => (
            <Card key={s.title} title={s.title}>
              <p className="mb-3 text-xs text-[var(--text-2)]">{s.rule}</p>
              <div className="space-y-2">
                {s.fields.map((f) => (
                  <label key={f.key} className="flex items-center gap-2">
                    <span className="w-56 text-[var(--text-2)]">{f.label}</span>
                    <input name={f.key} type="number" step={f.step ?? "1"} min={0} defaultValue={cfg[f.key]} className="num w-24" />
                    <span className="text-xs text-[var(--text-3)]">{f.unit}{cfg[f.key] !== DEFAULT_RULES[f.key] && ` (default ${DEFAULT_RULES[f.key]})`}</span>
                  </label>
                ))}
              </div>
            </Card>
          ))}
          <Card title="5 · Perishable list" className="lg:col-span-2">
            <p className="mb-3 text-xs text-[var(--text-2)]">The SKU file sets perishability; override it here for individual SKUs.</p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
              {skus.map((s) => {
                const o = cfg.perishableOverrides[s.id];
                return (
                  <label key={s.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{s.id} <span className="text-xs text-[var(--text-2)]">{s.name}</span></span>
                    <select name={`perishable:${s.id}`} defaultValue={o === undefined ? "file" : o ? "yes" : "no"} className="text-xs">
                      <option value="file">File: {s.perishable ? "perishable" : "not perishable"}</option>
                      <option value="yes">Perishable</option>
                      <option value="no">Not perishable</option>
                    </select>
                  </label>
                );
              })}
            </div>
          </Card>
          {planner && (
            <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
              <input name="note" placeholder="Why are you changing the rules? (required)" className="min-w-72 flex-1" />
              <Button>Save as new version</Button>
            </div>
          )}
        </fieldset>
      </form>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Version history">
          <ol className="space-y-3">
            {versions.map((v, i) => (
              <li key={v.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Version {v.id}</span>
                  {i === 0 && <Badge tone="good">in force</Badge>}
                  <span className="text-xs text-[var(--text-3)]">{v.createdBy} · {dateTimeLabel(v.createdAt)}</span>
                </div>
                {v.note && <div className="text-xs text-[var(--text-2)]">“{v.note}”</div>}
                <ul className="mt-1 font-mono text-xs text-[var(--text-2)]">
                  {diff(versions[i + 1] ? withDefaults(versions[i + 1].config) : null, withDefaults(v.config)).map((d) => <li key={d}>{d}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Baseline & kill-switch thresholds">
          <form action={saveBaseline}>
            <fieldset disabled={!planner} className="space-y-2">
              {([
                ["stockoutLossQuarterLow", "Stockout losses / quarter, low", "₹ L", lakh(baseline.stockoutLossQuarterLow)],
                ["stockoutLossQuarterHigh", "Stockout losses / quarter, high", "₹ L", lakh(baseline.stockoutLossQuarterHigh)],
                ["overstockQuarterLow", "Overstock write-offs / quarter, low", "₹ L", lakh(baseline.overstockQuarterLow)],
                ["overstockQuarterHigh", "Overstock write-offs / quarter, high", "₹ L", lakh(baseline.overstockQuarterHigh)],
                ["dataAgeDaysBaseline", "Data age before (days)", "days", baseline.dataAgeDaysBaseline],
                ["dataAgeTargetDays", "Data age target", "days", baseline.dataAgeTargetDays],
                ["plannerDaysPerMonth", "Raghav’s data work before", "days/month", baseline.plannerDaysPerMonth],
                ["buildCost", "Build cost (payback)", "₹ L", lakh(baseline.buildCost)],
                ["earlyRedPct", "Early kill: red above", "% edited/rejected", baseline.earlyRedPct],
                ["earlyAmberPct", "Early kill: amber above", "%", baseline.earlyAmberPct],
                ["earlyRuns", "…over the last", "runs", baseline.earlyRuns],
                ["outcomeMonthlyLimit", "Outcome kill: monthly loss limit", "₹ L", lakh(baseline.outcomeMonthlyLimit)],
                ["outcomeMonths", "…for consecutive months", "months", baseline.outcomeMonths],
                ["trackerVariancePct", "Tracker: flag actual vs forecast beyond", "± %", baseline.trackerVariancePct],
              ] as const).map(([key, label, unit, value]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-60 text-[var(--text-2)]">{label}</span>
                  <input name={key} type="number" step="any" min={0} defaultValue={value} className="num w-24" />
                  <span className="text-xs text-[var(--text-3)]">{unit}</span>
                </label>
              ))}
              {planner && <Button variant="secondary">Save baseline</Button>}
            </fieldset>
          </form>
        </Card>
      </div>
    </>
  );
}
