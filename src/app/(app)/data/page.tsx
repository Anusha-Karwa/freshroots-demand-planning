import { count, desc, eq, max, min, ne, countDistinct } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { ALL_DISTRIBUTORS } from "@/lib/data/clean";
import { autoMap, FILE_KINDS, type FileKind } from "@/lib/data/columns";
import { readCsv } from "@/lib/data/parse";
import { addDays, daysBetween, todayIst } from "@/lib/dates";
import { dateLabel, dateTimeLabel, num } from "@/lib/format";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { Badge, Button, Card, Empty, Flash, PageHeader, Stat } from "@/components/ui";
import { addMarketEvent, cancelUpload, confirmUpload, deleteMarketEvent, loadSeedAction, uploadCsv } from "../../actions";

export default async function DataPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const planner = session.role === "planner";

  const [[skuCount], [distCount], [sales], [distRows], [stock], loads, events, categories] = await Promise.all([
    db.select({ n: count() }).from(schema.skus).where(eq(schema.skus.active, true)),
    db.select({ n: count() }).from(schema.distributors),
    db.select({ first: min(schema.weeklySales.weekStart), last: max(schema.weeklySales.weekStart), weeks: countDistinct(schema.weeklySales.weekStart), rows: count() }).from(schema.weeklySales),
    db.select({ n: count() }).from(schema.weeklySales).where(ne(schema.weeklySales.distributorId, ALL_DISTRIBUTORS)),
    db.select({ asOf: max(schema.stockSnapshots.asOf), skus: countDistinct(schema.stockSnapshots.skuId) }).from(schema.stockSnapshots),
    db.select().from(schema.dataLoads).orderBy(desc(schema.dataLoads.id)).limit(12),
    db.select().from(schema.marketEvents).orderBy(desc(schema.marketEvents.startDate)).limit(30),
    db.selectDistinct({ c: schema.skus.category }).from(schema.skus),
  ]);
  const placeholder = await db.select({ n: count() }).from(schema.skus).where(eq(schema.skus.priceSource, "placeholder"));
  const dataThrough = sales.last ? addDays(sales.last, 6) : null;
  const age = dataThrough ? daysBetween(dataThrough, todayIst()) : null;

  const uploadId = Number(param(sp.upload));
  const [upload] = uploadId ? await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId)) : [];
  const parsed = upload ? readCsv(upload.content) : null;
  const guess = upload && parsed ? autoMap(upload.kind as FileKind, parsed.headers) : null;

  return (
    <>
      <PageHeader
        title="Data"
        subtitle="SAP exports in, cleaned into Postgres. The twice-weekly run uses whatever is loaded here; the IT team uploads the SAP export (sales + stock) before Mon/Thu 06:00 IST."
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="SKUs" value={num(skuCount.n)} sub={`${num(distCount.n)} distributors · ${placeholder[0].n ? `${placeholder[0].n} with placeholder prices` : "real prices"}`} />
        <Stat label="Sales weeks" value={num(sales.weeks)} sub={sales.first ? `${dateLabel(sales.first)} → week of ${dateLabel(sales.last)}` : "none"} />
        <Stat label="Sales through" value={dataThrough ? dateLabel(dataThrough) : "—"} sub={age == null ? undefined : `${age} days old · ${distRows.n ? "with distributor detail" : "SKU-level only (rule 6b off)"}`} tone={age == null ? undefined : age <= 4 ? "good" : age <= 14 ? "warn" : "bad"} />
        <Stat label="Stock as of" value={stock.asOf ? dateLabel(stock.asOf) : "—"} sub={`${num(stock.skus)} SKUs with a figure`} />
      </div>

      {upload && parsed && guess && planner ? (
        <Card title={`Map columns: ${upload.filename}`} className="mb-4">
          <p className="mb-3 text-xs text-[var(--text-2)]">{FILE_KINDS[upload.kind as FileKind].label} · {parsed.rows.length} rows. Check which column holds each field; required ones are marked *.</p>
          <form action={confirmUpload} className="space-y-2">
            <input type="hidden" name="uploadId" value={upload.id} />
            {FILE_KINDS[upload.kind as FileKind].fields.map((f) => (
              <label key={f.field} className="flex items-center gap-3">
                <span className="w-64">{f.label}{f.required && " *"}</span>
                <select name={`map:${f.field}`} defaultValue={guess[f.field] ?? ""}>
                  <option value="">— not in file —</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <div className="overflow-x-auto pt-2">
              <table className="data text-xs">
                <thead><tr>{parsed.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{parsed.rows.slice(0, 5).map((r, i) => <tr key={i}>{parsed.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="flex gap-2 pt-2">
              <Button>Load {parsed.rows.length} rows</Button>
              <Button variant="secondary" formAction={cancelUpload}>Cancel</Button>
            </div>
          </form>
        </Card>
      ) : planner && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <Card title="Upload a SAP export (CSV)">
            <form action={uploadCsv} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--text-2)]">What is in the file?</span>
                <select name="kind" defaultValue="sales" className="w-full">
                  {(Object.keys(FILE_KINDS) as FileKind[]).map((k) => <option key={k} value={k}>{FILE_KINDS[k].label}</option>)}
                </select>
              </label>
              <input type="file" name="file" accept=".csv,text/csv" required className="w-full" />
              <p className="text-xs text-[var(--text-3)]">Adds to / updates what is loaded: for sales, the file replaces the weeks × SKUs it contains. Excel files: save as CSV UTF-8 first. Format: docs/SAP_EXPORT_FORMAT.md.</p>
              <Button>Upload and map columns</Button>
            </form>
          </Card>
          <Card title="Seed data">
            <p className="mb-3 text-xs text-[var(--text-2)]">Reloads the five seed files in data/seed (calendar, SKUs, distributors, stock, weekly sales) plus placeholder prices. Replaces all sales and stock; keeps runs, decisions and POs.</p>
            <form action={loadSeedAction}><Button variant="secondary">Load the seed data</Button></form>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Market events (competitor schemes, one-offs)">
          <p className="mb-3 text-xs text-[var(--text-2)]">Context for Gemini’s reasons and “looks unusual” check. They never change the rule numbers.</p>
          {planner && (
            <form action={addMarketEvent} className="mb-3 grid grid-cols-2 gap-2">
              <select name="kind" defaultValue="competitor_scheme">
                <option value="competitor_scheme">Competitor scheme</option>
                <option value="festival">Festival / local event</option>
                <option value="other">Other</option>
              </select>
              <input name="description" required placeholder="e.g. Brand X 20% off juices, Pune" />
              <label className="text-xs text-[var(--text-2)]">From<input type="date" name="startDate" required className="mt-1 w-full" /></label>
              <label className="text-xs text-[var(--text-2)]">To<input type="date" name="endDate" className="mt-1 w-full" /></label>
              <input name="skuId" placeholder="SKU (blank = all)" />
              <select name="category" defaultValue=""><option value="">All categories</option>{categories.filter((c) => c.c).map((c) => <option key={c.c} value={c.c!}>{c.c}</option>)}</select>
              <div className="col-span-2"><Button variant="secondary">Add event</Button></div>
            </form>
          )}
          {events.length === 0 ? <Empty>No events.</Empty> : (
            <table className="data text-xs">
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td><Badge>{e.kind.replace("_", " ")}</Badge></td>
                    <td>{e.description}<div className="text-[var(--text-3)]">{e.skuId ?? e.category ?? "all SKUs"}</div></td>
                    <td className="whitespace-nowrap">{dateLabel(e.startDate)} → {dateLabel(e.endDate)}</td>
                    <td>{planner && <form action={deleteMarketEvent}><input type="hidden" name="id" value={e.id} /><button className="underline">remove</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Load history">
          {loads.length === 0 ? <Empty>Nothing loaded yet.</Empty> : (
            <table className="data text-xs">
              <thead><tr><th>When</th><th>File</th><th className="r">Loaded</th><th className="r">Rejected</th><th>Notes</th></tr></thead>
              <tbody>
                {loads.map((l) => {
                  const s = l.summary as { warnings?: string[]; rejected?: { row: number; reason: string }[] } | null;
                  return (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{dateTimeLabel(l.createdAt)}<div className="text-[var(--text-3)]">{l.loadedBy} · {l.source}</div></td>
                      <td>{l.filename}<div className="text-[var(--text-3)]">{FILE_KINDS[l.kind as FileKind]?.label}</div></td>
                      <td className="r num">{l.accepted}</td>
                      <td className="r num">{l.rejected ? <span className="text-[var(--bad)]">{l.rejected}</span> : 0}</td>
                      <td>
                        {s?.rejected?.slice(0, 3).map((r) => <div key={r.row}>row {r.row}: {r.reason}</div>)}
                        {s?.warnings?.map((w) => <div key={w}>{w}</div>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
