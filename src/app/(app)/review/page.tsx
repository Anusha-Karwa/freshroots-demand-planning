import { getSession } from "@/lib/auth";
import { dateLabel, num } from "@/lib/format";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { queueItems, type QueueRow } from "@/lib/queries";
import { FLAG_LABEL, type Flag } from "@/lib/rules/engine";
import { Empty, Flash, PageHeader, TextLink } from "@/components/ui";
import { DecisionForm, DecisionStatus } from "@/components/DecisionForm";
import { AfterOrder, CoverBar, Headline, LastTime, KeyNumbers, NumbersDetail, Reason, SkuCard, coverWhy, metricRows, standardNumbers } from "@/components/SkuCard";
import { lastDecisions, type PastDecision } from "@/lib/feedback";
import { bulkApproveAction } from "../../actions";

function headline(row: QueueRow) {
  const { item } = row;
  const m = item.metrics;
  const flags = item.flags as Flag[];
  const qty = item.recommendedQty ?? 0;
  if (item.action === "pause" || qty === 0) return { title: "Pause the next order", tone: "warn" as const };
  const tone = flags.includes("STOCKOUT_RISK") ? ("bad" as const) : ("info" as const);
  const extra = flags.includes("HIGH_DEMAND") && m.changePct != null ? ` · demand up ${Math.round(m.changePct)}%` : "";
  return { title: `Order ${num(qty)}${extra}`, tone };
}

function ReviewCard({ row, planner, back, last }: { row: QueueRow; planner: boolean; back: string; last?: PastDecision }) {
  const { item } = row;
  const m = item.metrics;
  const h = headline(row);
  return (
    <SkuCard
      row={row}
      aside={<><DecisionStatus row={row} />{planner && <DecisionForm row={row} back={back} />}</>}
    >
      <Headline title={h.title} why={coverWhy(m)} tone={h.tone} />
      <CoverBar m={m} />
      <AfterOrder m={m} qty={item.finalQty ?? item.recommendedQty} />
      <LastTime d={last} />
      <KeyNumbers items={standardNumbers(m)} />
      <Reason text={item.reason} source={item.reasonSource} />
      <NumbersDetail rows={metricRows(m)} />
    </SkuCard>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const { run, items } = await queueItems(db, "review");
  const past = run ? await lastDecisions(db, items.map((r) => r.sku.id), run.id) : new Map<string, PastDecision>();
  const filter = param(sp.flag) as Flag | undefined;
  const planner = session.role === "planner";
  const inFilter = items.filter((r) => !filter || r.item.flags.includes(filter));
  const pending = inFilter.filter((r) => r.item.decision === "pending");
  const decided = inFilter.filter((r) => r.item.decision !== "pending");
  const bulk = items.filter((r) => r.item.flags.includes("STOCKOUT_RISK") && r.item.decision === "pending" && !r.item.poId);
  const back = `/review${filter ? `?flag=${filter}` : ""}`;

  const tab = (label: string, f?: Flag) => {
    const n = items.filter((r) => !f || r.item.flags.includes(f)).length;
    const active = f === filter;
    return (
      <a key={label} href={`/review${f ? `?flag=${f}` : ""}`} aria-current={active ? "page" : undefined}
        className={`rounded-full px-4 py-2 text-sm font-bold ${active ? "bg-[var(--ink)] text-[var(--green)]" : "bg-[var(--surface)] text-[var(--text-2)] ring-1 ring-[var(--border)] hover:bg-[var(--surface-2)]"}`}>
        {label} <span className="num opacity-70">{n}</span>
      </a>
    );
  };

  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle={run
          ? <>Run #{run.id} · sales through {dateLabel(run.dataThrough)}. Quantities come from the rules; you make the final call.</>
          : "Quantities come from the rules; you make the final call."}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      {!run ? <Empty>No forecast run yet. Run one from the <TextLink href="/">Overview</TextLink>.</Empty> : (
        <div className="space-y-6">
          {planner && bulk.length > 1 && (
            <form action={bulkApproveAction} className="rounded-2xl border-2 border-[var(--ink)] bg-[var(--surface)] p-6">
              <h2 className="display text-3xl">Approve all stockout reorders at <span className="hl">once</span></h2>
              <p className="mt-0.5 text-sm text-[var(--text-2)]">Untick any you want to look at one by one below.</p>
              <ul className="mt-3 divide-y divide-[var(--border)]">
                {bulk.map(({ item, sku }) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input type="checkbox" name="itemId" value={item.id} defaultChecked aria-label={`Include ${sku.id}`} className="size-4" />
                      <span className="flex-1">{sku.name}</span>
                      <span className="num hidden text-sm text-[var(--text-3)] sm:inline">{item.metrics.weeksCover} wk left</span>
                      <span className="num w-24 text-right font-semibold">Order {num(item.recommendedQty)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed" required className="size-4" /> I have checked these lines</label>
                <button className="rounded-full bg-[var(--green)] px-6 py-2.5 text-sm font-bold text-[var(--ink)] transition hover:scale-105">Approve selected</button>
              </div>
            </form>
          )}

          <nav className="flex flex-wrap gap-2" aria-label="Filter by flag">
            {tab("All")}
            {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => tab(FLAG_LABEL[f], f))}
          </nav>

          <section className="space-y-3">
            <h2 className="display text-2xl">Waiting for you <span className="text-[var(--text-3)]">· {pending.length}</span></h2>
            {pending.length === 0
              ? <Empty>Nothing waiting here. {decided.length > 0 && "Everything below is decided."}</Empty>
              : pending.map((row) => <ReviewCard key={row.item.id} row={row} planner={planner} back={back} last={past.get(row.sku.id)} />)}
          </section>

          {decided.length > 0 && (
            <details className="group space-y-3" open={pending.length === 0}>
              <summary className="display cursor-pointer text-2xl text-[var(--text-3)]">Decided · {decided.length}</summary>
              <div className="mt-3 space-y-3">
                {decided.map((row) => <ReviewCard key={row.item.id} row={row} planner={planner} back={back} last={past.get(row.sku.id)} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );
}
