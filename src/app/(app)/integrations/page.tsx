import { desc } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { dateTimeLabel } from "@/lib/format";
import { geminiModel, integrationStatus, zohoApiBase } from "@/lib/integrations";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { Badge, Button, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { testIntegration } from "../../actions";

const TESTABLE = new Set(["database", "gemini", "zoho", "email"]);

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const status = integrationStatus();
  const [emails, mockEmails] = await Promise.all([
    db.select().from(schema.emailLog).orderBy(desc(schema.emailLog.id)).limit(10),
    db.select().from(schema.mockEmails).orderBy(desc(schema.mockEmails.id)).limit(5),
  ]);

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Each service runs LIVE when its keys are set (in .env locally, or Vercel → Settings → Environment Variables), and MOCK otherwise. Adding a key and redeploying is all it takes to switch."
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      <div className="mb-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <table className="data">
          <thead><tr><th>Service</th><th>Mode</th><th>What it does now</th><th>Missing variables</th>{session.role === "planner" && <th></th>}</tr></thead>
          <tbody>
            {status.map((s) => (
              <tr key={s.service}>
                <td className="font-medium">{s.name}</td>
                <td><Badge tone={s.mode === "live" ? "good" : "warn"}>{s.mode === "live" ? "Live" : "Mock"}</Badge></td>
                <td className="text-xs">
                  {s.mode === "live" ? s.live : s.mock}
                  {s.service === "gemini" && <div className="text-[var(--text-3)]">Model: {geminiModel()}</div>}
                  {s.service === "zoho" && <div className="text-[var(--text-3)]">API: {zohoApiBase()}</div>}
                </td>
                <td className="font-mono text-xs">{s.missing.join(", ") || "—"}</td>
                {session.role === "planner" && (
                  <td>
                    {TESTABLE.has(s.service) && (
                      <form action={testIntegration}><input type="hidden" name="service" value={s.service} /><Button variant="secondary">Test</Button></form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Email log">
          {emails.length === 0 ? <Empty>No emails yet.</Empty> : (
            <table className="data text-xs">
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{dateTimeLabel(e.createdAt)}</td>
                    <td><Badge tone={e.mode === "live" ? "info" : "warn"}>{e.mode}</Badge> <Badge tone={e.status === "sent" ? "good" : e.status === "failed" ? "bad" : "mute"}>{e.status}</Badge></td>
                    <td>{e.subject}<div className="text-[var(--text-3)]">to {e.to}{e.detail ? ` · ${e.detail}` : ""}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Latest mock emails">
          {mockEmails.length === 0 ? <Empty>None.</Empty> : mockEmails.map((m) => (
            <details key={m.id} className="mb-2 rounded-md border border-[var(--border)] p-2 text-xs">
              <summary className="cursor-pointer">{m.subject} <span className="text-[var(--text-3)]">→ {m.to}</span></summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{m.body}</pre>
            </details>
          ))}
        </Card>
      </div>
    </>
  );
}
