import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { dataStatus } from "@/lib/data-status";
import { FILE_SPECS, LOAD_ORDER } from "@/lib/seed/columns";
import { inspectFile } from "@/lib/seed/loader";
import { getReport, getUpload } from "@/lib/uploads";
import { Card, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { num } from "@/lib/ui/format";
import { loadUpload, runForecastNow, uploadCsv } from "../actions";

export const dynamic = "force-dynamic";

type SP = { ok?: string; error?: string; upload?: string; report?: string };

async function MappingStep({ token }: { token: string }) {
  const up = await getUpload(token);
  if (!up) return <Notice tone="error">Upload expired — please upload the file again.</Notice>;
  const spec = FILE_SPECS[up.meta.type];
  const info = await inspectFile(up.meta.type, up.csvPath, 5);
  return (
    <Card title={`Step 2 · Map columns — ${up.meta.fileName} (${spec.description}, ${num(info.rows)} rows)`}>
      <form action={loadUpload} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Column in your file</th><th className="py-1">Notes</th></tr>
            </thead>
            <tbody>
              {spec.fields.map((f) => (
                <tr key={f.field} className="border-t border-stone-100">
                  <td className="py-1 pr-3">
                    {f.field} {f.required && <span className="text-red-700">*</span>}
                  </td>
                  <td className="py-1 pr-3">
                    <select name={`map:${f.field}`} defaultValue={info.mapping.mapped[f.field] ?? ""} className={inputCls}>
                      <option value="">— not in file —</option>
                      {info.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                  <td className="py-1 text-xs text-stone-500">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-stone-600">First {info.sample.length} rows</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="text-xs">
              <thead><tr>{info.headers.map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>
                {info.sample.map((r, i) => (
                  <tr key={i} className="border-t border-stone-100">{info.headers.map((h) => <td key={h} className="px-2 py-1">{r[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="text-xs text-stone-500">
          Rows are added to (or update) what is already loaded. Rows with an unknown SKU or distributor, an unreadable value,
          a week outside the calendar or negative stock are rejected and listed.
        </p>
        <button className={btnCls}>Step 3 · Load</button>
      </form>
    </Card>
  );
}

async function ReportStep({ token, canRun }: { token: string; canRun: boolean }) {
  const report = await getReport(token);
  if (!report) return <Notice tone="error">Load report not found.</Notice>;
  return (
    <Card title="Load report" right={canRun && <form action={runForecastNow}><button className={btnCls}>Run forecast on the new data</button></form>}>
      {report.files.map((f) => (
        <div key={f.type} className="text-sm">
          <p>
            <b>{f.type}</b>: read {num(f.rowsRead)}, accepted {num(f.accepted)}, rejected{" "}
            <span className={f.rejected ? "text-red-700" : ""}>{num(f.rejected)}</span>, duplicates {num(f.duplicates)}
            {f.dataAsOf && <> · data as of {f.dataAsOf}</>}
          </p>
          {f.warnings.map((w) => <p key={w} className="text-amber-700">⚠ {w}</p>)}
          {Object.entries(f.rejectionsByReason).map(([r, n]) => <p key={r} className="text-red-700">rejected {n} × {r}</p>)}
          {f.sampleRejections.slice(0, 10).map((s) => <p key={s.row} className="text-xs text-stone-500">row {s.row}: {s.reason}</p>)}
        </div>
      ))}
      <ul className="mt-3 space-y-0.5 text-sm">
        {report.checks.map((c) => (
          <li key={c.name} className={c.passed ? "" : "text-red-700"}>{c.passed ? "✓" : "✗"} {c.name} — {c.detail}</li>
        ))}
      </ul>
    </Card>
  );
}

export default async function DataPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const canUpload = user.role === "planner";
  const db = await getDb();
  const [s, rejected] = await Promise.all([
    dataStatus(),
    db
      .select({ r: schema.rejectedRows, l: schema.dataLoads })
      .from(schema.rejectedRows)
      .innerJoin(schema.dataLoads, eq(schema.dataLoads.id, schema.rejectedRows.loadId))
      .orderBy(desc(schema.rejectedRows.id))
      .limit(20),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Data</h1>
        <p className="text-sm text-stone-600">
          Sales up to {s.dataAsOf ?? "—"} ({s.dataAgeDays ?? "—"} days old) · {s.skus} SKUs · {s.distributors} distributors · {s.weeks} weeks.
          Upload the IT team’s SAP export here; the format is in <code>docs/SAP_EXPORT_FORMAT.md</code>.
        </p>
      </div>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      {sp.upload ? (
        <MappingStep token={sp.upload} />
      ) : sp.report ? (
        <ReportStep token={sp.report} canRun={canUpload} />
      ) : (
        canUpload && (
          <Card title="Step 1 · Upload a SAP export (CSV)">
            <form action={uploadCsv} className="flex flex-wrap items-center gap-2 text-sm">
              <select name="type" required defaultValue="weekly_sales" className={inputCls}>
                {LOAD_ORDER.map((t) => <option key={t} value={t}>{FILE_SPECS[t].description}</option>)}
              </select>
              <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
              <button className={btnCls}>Upload</button>
            </form>
          </Card>
        )
      )}
      {(sp.upload || sp.report) && <a href="/data" className={`${btnGhostCls} inline-block`}>Upload another file</a>}

      <Card title="Recent loads">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="py-1 pr-3">When (IST)</th><th className="py-1 pr-3">Source</th><th className="py-1 pr-3">File</th>
                <th className="py-1 pr-3">Type</th><th className="py-1 pr-3 text-right">Accepted</th><th className="py-1 pr-3 text-right">Rejected</th><th className="py-1">Data as of</th>
              </tr>
            </thead>
            <tbody>
              {s.loads.map((l) => (
                <tr key={l.id} className="border-t border-stone-100">
                  <td className="py-1 pr-3">{l.loadedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="py-1 pr-3">{l.source === "sap_csv" ? "SAP upload" : "seed"}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{l.fileName.split("/").pop()}</td>
                  <td className="py-1 pr-3">{l.fileType}</td>
                  <td className="py-1 pr-3 text-right">{num(l.rowsAccepted)}</td>
                  <td className={`py-1 pr-3 text-right ${l.rowsRejected ? "text-red-700" : ""}`}>{num(l.rowsRejected)}</td>
                  <td className="py-1">{l.dataAsOf ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {rejected.length > 0 && (
        <Card title="Recently rejected rows">
          <ul className="space-y-0.5 text-xs">
            {rejected.map(({ r, l }) => (
              <li key={r.id}>{l.fileName.split("/").pop()} row {r.rowNumber}: {r.reason}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
