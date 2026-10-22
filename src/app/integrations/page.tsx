import { integrationStatuses } from "@/lib/integrations";
import { dbMode } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { recentEmails } from "@/lib/notify";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requireUser();
  const rows = integrationStatuses();
  const emails = await recentEmails();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Integrations</h1>
      <p className="text-sm text-stone-600">
        Each service runs <b>Live</b> when its keys are set (in <code>.env</code> or Vercel → Settings → Environment
        Variables), otherwise <b>Mock</b>. Database: <code>{dbMode()}</code>.
      </p>
      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">In mock mode</th>
              <th className="px-3 py-2">Missing variables</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-stone-100 align-top">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      r.mode === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {r.mode === "live" ? "Live" : "Mock"}
                  </span>
                </td>
                <td className="px-3 py-2 text-stone-600">{r.mockBehaviour}</td>
                <td className="px-3 py-2 font-mono text-xs text-stone-500">{r.missing.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded border border-stone-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Scheduled jobs (Vercel Cron, see vercel.json)</h2>
        <ul className="mt-1 list-disc pl-5 text-stone-600">
          <li><code>/api/cron/forecast</code> — Mon + Thu 06:00 IST: rules → Gemini reasons → email Raghav “N items awaiting your call”.</li>
          <li><code>/api/cron/tracker</code> — daily 07:00 IST: actual vs forecast, stockouts, kill switch (email Deepa if it turns red), Zoho PO status.</li>
        </ul>
        <p className="mt-1 text-xs text-stone-500">Both require <code>Authorization: Bearer $CRON_SECRET</code>; Vercel sends it automatically once CRON_SECRET is set.</p>
      </div>

      <div className="rounded border border-stone-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Emails logged in mock mode</h2>
        {emails.length === 0 ? (
          <p className="mt-1 text-stone-500">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {emails.map((e) => (
              <li key={e.id} className="border-t border-stone-100 pt-2">
                <div>
                  <b>{e.subject}</b> <span className="text-xs text-stone-500">to {e.to} · {e.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-stone-600">{e.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
