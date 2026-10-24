import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { cronAuthorized } from "@/lib/cron";
import { runForecast } from "@/lib/forecast/run";
import { notifyPlanner } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Mon + Thu 06:00 IST (00:30 UTC): latest SAP data → rules → Gemini → email Raghav "N items awaiting your call". */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const db = await getDb();
    const run = await runForecast(db, { trigger: "cron" });
    const email = await notifyPlanner(db, run);
    return NextResponse.json({ ok: true, ...run, email: email?.status ?? "nothing to review" });
  } catch (err) {
    console.error("[cron/forecast]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
