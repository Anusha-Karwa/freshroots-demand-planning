import { getSession } from "@/lib/auth";
import { dateLabel, num } from "@/lib/format";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { queueItems, type QueueRow } from "@/lib/queries";
import { EXCEPTION_LABEL, FLAG_LABEL, type ExceptionCode, type Flag } from "@/lib/rules/engine";
import { Badge, Empty, Flash, PageHeader, TextLink } from "@/components/ui";
import { DecisionForm, DecisionStatus } from "@/components/DecisionForm";
import { lastDecisions, type PastDecision } from "@/lib/feedback";
import { CoverBar, Headline, LastTime, KeyNumbers, NumbersDetail, Reason, SkuCard, coverWhy, metricRows, standardNumbers } from "@/components/SkuCard";

function rulesWouldSay(row: QueueRow) {
  const { item } = row;
  const q = item.metrics.ruleSuggestedQty;
  const flags = (item.flags as Flag[]).map((f) => FLAG_LABEL[f].toLowerCase()).join(", ");
  if (q == null) return flags ? `Rules flag ${flags} but can’t size an order` : "The rules have no suggestion";
  return q === 0 ? `Rules alone would pause the next order${flags ? ` (${flags})` : ""}` : `Rules alone would order ${num(q)}${flags ? ` (${flags})` : ""}`;
}

export default async function ExceptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const { run, items } = await queueItems(db, "exception");
  const past = run ? await lastDecisions(db, items.map((r) => r.sku.id), run.id) : new Map<string, PastDecision>();
  const planner = session.role === "planner";
  const pending = items.filter((r) => r.item.decision === "pending");
  const decided = items.filter((r) => r.item.decision !== "pending");

  const card = (row: QueueRow) => {
    const { item } = row;
    const m = item.metrics;
    return (
      <SkuCard key={item.id} row={row} aside={<><DecisionStatus row={row} />{planner && <DecisionForm row={row} back="/exceptions" exception />}</>}>
        <div className="flex flex-wrap gap-1.5">
          {(item.exceptions as ExceptionCode[]).map((e) => <Badge key={e} tone={e === "AI_UNUSUAL" ? "info" : "warn"}>{EXCEPTION_LABEL[e]}</Badge>)}
        </div>
        <Headline title={rulesWouldSay(row)} why={coverWhy(m)} tone="mute" />
        <CoverBar m={m} />
        <KeyNumbers items={standardNumbers(m)} />
        <Reason note={item.aiNote} text={item.reason} source={item.reasonSource} />
        <LastTime d={past.get(row.sku.id)} />
        <NumbersDetail rows={metricRows(m)} />
      </SkuCard>
    );
  };

  return (
    <>
      <PageHeader
        title="Exceptions"
        subtitle={<>Cases the rules can’t settle on their own: new SKUs, sudden swings, one distributor driving demand, or something Gemini finds unusual. You set the quantity.{run && <> Run #{run.id} · sales through {dateLabel(run.dataThrough)}.</>}</>}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />
      {!run ? <Empty>No forecast run yet. Run one from the <TextLink href="/">Overview</TextLink>.</Empty> : items.length === 0 ? (
        <Empty>No exceptions in run #{run.id}. The rules covered every flagged SKU.</Empty>
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="display text-2xl">Waiting for you <span className="text-[var(--text-3)]">· {pending.length}</span></h2>
            {pending.length === 0 ? <Empty>All exceptions in this run are decided.</Empty> : pending.map(card)}
          </section>
          {decided.length > 0 && (
            <details className="space-y-3" open={pending.length === 0}>
              <summary className="display cursor-pointer text-2xl text-[var(--text-3)]">Decided · {decided.length}</summary>
              <div className="mt-3 space-y-3">{decided.map(card)}</div>
            </details>
          )}
        </div>
      )}
    </>
  );
}
