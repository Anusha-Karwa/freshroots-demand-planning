import { getSession } from "@/lib/auth";
import { dateLabel, num, pct } from "@/lib/format";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { queueItems } from "@/lib/queries";
import { EXCEPTION_LABEL, FLAG_LABEL, type ExceptionCode, type Flag } from "@/lib/rules/engine";
import { Badge, Empty, Flash, PageHeader, TextLink } from "@/components/ui";
import { DecisionForm, DecisionStatus } from "@/components/DecisionForm";
import { CoverCell, ExpectedCell, TrendCell } from "@/components/Numbers";

export default async function ExceptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const { run, items } = await queueItems(db, "exception");
  const planner = session.role === "planner";

  return (
    <>
      <PageHeader
        title="Exceptions"
        subtitle={<>Cases the rules can’t decide — new SKUs, big week-on-week swings, one distributor driving the change, rules that disagree, or a case Gemini thinks looks unusual. These are the 15–20% Raghav handles on judgement: there is no rule quantity, you set it. {run && <>Run #{run.id}, sales through {dateLabel(run.dataThrough)}.</>}</>}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />
      {!run ? <Empty>No forecast run yet. Run one from the <TextLink href="/">Overview</TextLink>.</Empty> : items.length === 0 ? (
        <Empty>No exceptions in run #{run.id}. Every flagged SKU was covered by the rules.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="data">
            <thead>
              <tr>
                <th>SKU</th><th>Why it’s here</th><th>Last week vs before</th><th className="r">Stock</th><th>Weeks of cover</th><th>4-wk vs 12-wk</th>
                <th className="r">Expected</th><th>Rules alone would say</th><th>Note (Gemini)</th><th>Your call</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const { item, sku } = row;
                const m = item.metrics;
                return (
                  <tr key={item.id}>
                    <td className="min-w-40">
                      <div className="font-medium">{sku.id}</div>
                      <div className="text-xs text-[var(--text-2)]">{sku.name}</div>
                      {m.perishable && <Badge tone="warn">Perishable</Badge>}
                    </td>
                    <td><div className="flex flex-col gap-1">{(item.exceptions as ExceptionCode[]).map((e) => <Badge key={e} tone={e === "AI_UNUSUAL" ? "info" : "warn"}>{EXCEPTION_LABEL[e]}</Badge>)}</div></td>
                    <td className="num">
                      {num(m.lastWeek)} vs {num(m.prevWeek)}
                      <div className="text-xs text-[var(--text-3)]">{m.wowPct == null ? (m.prevWeek === 0 && (m.lastWeek ?? 0) > 0 ? "from zero" : "—") : pct(m.wowPct)} · {m.weeksOfHistory} wks history</div>
                      {m.topDistributor && <div className="text-xs text-[var(--text-3)]">{m.topDistributor.id}: {Math.round(m.topDistributor.sharePct)}% of change</div>}
                    </td>
                    <td className="r num">{num(m.stock)}</td>
                    <td><CoverCell m={m} /></td>
                    <td><TrendCell m={m} /></td>
                    <td className="r"><ExpectedCell m={m} /></td>
                    <td className="text-xs">
                      {item.flags.length ? (item.flags as Flag[]).map((f) => FLAG_LABEL[f]).join(", ") : "No flag"}
                      {m.ruleSuggestedQty != null && <div className="num">qty {num(m.ruleSuggestedQty)}</div>}
                    </td>
                    <td className="min-w-48 max-w-[15rem] text-xs">
                      {item.aiNote && <div className="mb-1 font-medium">{item.aiNote}</div>}
                      {item.reason}
                      <div className="mt-1"><Badge tone={item.reasonSource === "gemini" ? "info" : "mute"}>{item.reasonSource === "gemini" ? "Gemini" : "Template"}</Badge></div>
                    </td>
                    <td><DecisionStatus row={row} />{planner && <DecisionForm row={row} back="/exceptions" exception />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
