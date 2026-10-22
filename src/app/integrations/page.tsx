import { integrationStatuses } from "@/lib/integrations";
import { dbMode } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  const rows = integrationStatuses();
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
    </div>
  );
}
