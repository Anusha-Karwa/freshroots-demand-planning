import { getSession } from "@/lib/auth";
import { dateLabel, num } from "@/lib/format";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { queueItems } from "@/lib/queries";
import { FLAG_LABEL, type Flag } from "@/lib/rules/engine";
import { actionLabel } from "@/lib/rules/reason";
import { Badge, Card, Empty, Flash, PageHeader, TextLink } from "@/components/ui";
import { DecisionForm, DecisionStatus } from "@/components/DecisionForm";
import { CoverCell, ExpectedCell, TrendCell } from "@/components/Numbers";
import { bulkApproveAction } from "../../actions";

const FLAG_TONE: Record<Flag, "bad" | "info" | "warn"> = { STOCKOUT_RISK: "bad", HIGH_DEMAND: "info", OVERSTOCK_RISK: "warn" };

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const { run, items } = await queueItems(db, "review");
  const filter = param(sp.flag) as Flag | undefined;
  const status = param(sp.status) ?? "all";
  const shown = items
    .filter((r) => !filter || r.item.flags.includes(filter))
    .filter((r) => status === "all" || (status === "pending" ? r.item.decision === "pending" : r.item.decision !== "pending"));
  const bulk = items.filter((r) => r.item.flags.includes("STOCKOUT_RISK") && r.item.decision === "pending" && !r.item.poId);
  const planner = session.role === "planner";
  const pending = items.filter((r) => r.item.decision === "pending").length;
  const back = `/review${filter || status !== "all" ? `?${new URLSearchParams({ ...(filter ? { flag: filter } : {}), ...(status !== "all" ? { status } : {}) })}` : ""}`;

  const link = (label: string, f?: string, s?: string) => {
    const qs = new URLSearchParams({ ...(f ? { flag: f } : {}), ...(s && s !== "all" ? { status: s } : {}) }).toString();
    const active = (f ?? undefined) === filter && (s ?? "all") === status;
    return (
      <a key={label} href={`/review${qs ? `?${qs}` : ""}`} className={`rounded-md px-2.5 py-1 text-xs ${active ? "bg-[var(--surface-2)] font-semibold" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"}`}>{label}</a>
    );
  };

  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle={<>Your final call. The rules computed every quantity; Gemini only explains. Approve, edit the quantity, or reject — edits and rejections need a reason. {run && <>Run #{run.id}, sales through {dateLabel(run.dataThrough)}.</>}</>}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      {!run ? <Empty>No forecast run yet. Run one from the <TextLink href="/">Overview</TextLink>.</Empty> : (
        <>
          {planner && bulk.length > 0 && (
            <Card title={`Bulk approve stockout risk (${bulk.length})`} className="mb-4">
              <form action={bulkApproveAction}>
                <p className="mb-2 text-xs text-[var(--text-2)]">Check each line’s numbers below before approving. Untick any line you want to handle one by one.</p>
                <table className="data mb-3">
                  <thead><tr><th></th><th>SKU</th><th className="r">Stock</th><th>Cover</th><th className="r">Expected</th><th className="r">Rule qty</th></tr></thead>
                  <tbody>
                    {bulk.map(({ item, sku }) => (
                      <tr key={item.id}>
                        <td><input type="checkbox" name="itemId" value={item.id} defaultChecked aria-label={`Include ${sku.id}`} /></td>
                        <td>{sku.id} · {sku.name}</td>
                        <td className="r num">{num(item.metrics.stock)}</td>
                        <td><CoverCell m={item.metrics} /></td>
                        <td className="r"><ExpectedCell m={item.metrics} /></td>
                        <td className="r num font-semibold">{num(item.recommendedQty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label className="mr-3 inline-flex items-center gap-2"><input type="checkbox" name="reviewed" required /> I have reviewed these lines</label>
                <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)]">Approve selected</button>
              </form>
            </Card>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-1">
            {link(`All (${items.length})`, undefined, status)}
            {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => link(`${FLAG_LABEL[f]} (${items.filter((r) => r.item.flags.includes(f)).length})`, f, status))}
            <span className="mx-2 text-[var(--border)]">|</span>
            {link(`Pending (${pending})`, filter, "pending")}
            {link("Decided", filter, "decided")}
            {link("Any status", filter, "all")}
          </div>

          {shown.length === 0 ? <Empty>Nothing here.</Empty> : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <table className="data">
                <thead>
                  <tr>
                    <th>SKU</th><th>Flag</th><th className="r">Stock</th><th>Weeks of cover</th><th>4-wk vs 12-wk</th><th className="r">Expected</th>
                    <th className="r">Recommended</th><th>Why (reason)</th><th>Your call</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const { item, sku } = row;
                    const m = item.metrics;
                    return (
                      <tr key={item.id}>
                        <td className="min-w-40">
                          <div className="font-medium">{sku.id}</div>
                          <div className="text-xs text-[var(--text-2)]">{sku.name}</div>
                          <div className="mt-0.5 flex gap-1 text-xs text-[var(--text-3)]">{sku.category}{m.perishable && <Badge tone="warn">Perishable</Badge>}</div>
                        </td>
                        <td><div className="flex flex-col gap-1">{(item.flags as Flag[]).map((f) => <Badge key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</Badge>)}</div></td>
                        <td className="r num">{num(m.stock)}</td>
                        <td><CoverCell m={m} /></td>
                        <td><TrendCell m={m} /></td>
                        <td className="r"><ExpectedCell m={m} /></td>
                        <td className="r num">
                          <div className="font-semibold">{num(item.recommendedQty)}</div>
                          <div className="text-xs text-[var(--text-3)]">{actionLabel(item.action)} · std {num(sku.standardOrderQty)}</div>
                        </td>
                        <td className="min-w-48 max-w-[15rem] text-xs">
                          {item.reason}
                          <div className="mt-1"><Badge tone={item.reasonSource === "gemini" ? "info" : "mute"}>{item.reasonSource === "gemini" ? "Gemini" : "Template"}</Badge></div>
                        </td>
                        <td><DecisionStatus row={row} />{planner && <DecisionForm row={row} back={back} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
