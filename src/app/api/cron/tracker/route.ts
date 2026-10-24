import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { cronAuthorized } from "@/lib/cron";
import { runTracker } from "@/lib/tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Daily 07:00 IST (01:30 UTC): actual vs forecast, stockouts, PO status sync, kill switch (emails Deepa on red). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runTracker(await getDb());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/tracker]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
