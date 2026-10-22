import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { runForecast } from "@/lib/rules/run";
import { notifyPlanner } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Gemini calls for 400 SKUs can take a while

/**
 * Mon + Thu 06:00 IST (00:30 UTC, see vercel.json): rules on the latest loaded data → Gemini reasons →
 * email Raghav "N items awaiting your call". Data arrives via the SAP upload on the Data page.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const run = await runForecast("cron");
    const email = await notifyPlanner(run);
    return NextResponse.json({ ok: true, runId: run.runId, dataAsOf: run.dataAsOf, counts: run.counts, email: email?.mode ?? "none" });
  } catch (err) {
    console.error("[cron/forecast]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
