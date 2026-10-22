import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { decisionsByRun, monthlyLossRows, toMonthLoss, updateTracker } from "@/lib/tracker";
import { killSwitch } from "@/lib/killswitch";
import { getBaseline } from "@/lib/settings";
import { notifyKillSwitch } from "@/lib/notify";
import { integrationMode } from "@/lib/integrations";
import { syncStatuses } from "@/lib/purchase-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Daily 07:00 IST (01:30 UTC): actual vs forecast, stockouts, kill-switch status (emails Deepa if it turns red). */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const tracker = await updateTracker();
    const k = killSwitch(await decisionsByRun(), toMonthLoss(await monthlyLossRows()), await getBaseline());
    const email = await notifyKillSwitch(k);
    // Pick up procurement's confirmations in Zoho (a failure here shouldn't fail the tracker).
    const poStatusChanges = integrationMode("zoho") === "live" ? await syncStatuses().catch((e) => `error: ${e.message}`) : 0;
    return NextResponse.json({ ok: true, tracker, killSwitch: k.overall, email: email?.mode ?? "none", poStatusChanges });
  } catch (err) {
    console.error("[cron/tracker]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
