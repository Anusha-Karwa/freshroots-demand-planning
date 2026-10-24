import { inArray } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { sendEmail } from "@/lib/adapters/email";
import { appUrl } from "@/lib/integrations";
import type { KillSwitch } from "@/lib/killswitch";
import { inr } from "@/lib/format";

/** The three emails the system sends: Raghav after a run, procurement after POs, Deepa when the kill switch turns red. */

export async function notifyPlanner(db: Db, run: { runId: number; dataThrough: string; counts: Record<string, number> }) {
  const waiting = (run.counts.review ?? 0) + (run.counts.exceptions ?? 0);
  if (!waiting) return null;
  return sendEmail(db, {
    to: process.env.PLANNER_EMAIL,
    subject: `${waiting} item${waiting === 1 ? "" : "s"} awaiting your call — demand plan run #${run.runId}`,
    text: [
      "Hi Raghav,",
      "",
      `The demand plan ran on sales data through ${run.dataThrough}.`,
      `• ${run.counts.review} recommendation(s) to review (${run.counts.stockoutRisk} stockout risk, ${run.counts.highDemand} high demand, ${run.counts.overstockRisk} overstock)`,
      `• ${run.counts.exceptions} exception(s) that need your judgement`,
      "",
      `Review queue: ${appUrl()}/review`,
      `Exceptions: ${appUrl()}/exceptions`,
      "",
      "Nothing is ordered until you approve it.",
    ].join("\n"),
  });
}

export async function notifyProcurement(db: Db, poIds: number[]) {
  const pos = await db.select().from(schema.purchaseOrders).where(inArray(schema.purchaseOrders.id, poIds));
  if (!pos.length) return null;
  const isMock = pos.every((p) => p.mode === "mock");
  return sendEmail(db, {
    to: process.env.PROCUREMENT_EMAIL,
    subject: `${pos.length} draft purchase order${pos.length === 1 ? "" : "s"} ready to confirm in Zoho${isMock ? " (MOCK)" : ""}`,
    text: [
      "Hi team,",
      "",
      "The demand planner approved these orders. They are drafts in Zoho Inventory — please check and issue them there:",
      ...pos.map((p) => `• ${p.zohoPoNumber ?? `PO #${p.id}`} — supplier ${p.supplierId}, ${inr(p.total ?? 0)}${p.mode === "mock" ? " [MOCK, not in Zoho]" : ""}`),
      "",
      `Details: ${appUrl()}/purchase-orders`,
    ].join("\n"),
  });
}

export async function notifyKillSwitchRed(db: Db, ks: KillSwitch) {
  return sendEmail(db, {
    to: process.env.VIEWER_EMAIL,
    subject: "Demand planning kill switch is RED",
    text: [
      "Hi Deepa,",
      "",
      "The demand-planning system hit a kill criterion:",
      ...ks.messages.map((m) => `• ${m}`),
      "",
      ks.early.status === "red" ? "Early kill switch: halt and re-evaluate the rules with Raghav." : "",
      ks.outcome.status === "red" ? "Outcome kill switch: stop, run a root-cause analysis, fix, redeploy." : "",
      "",
      `Dashboard: ${appUrl()}/`,
    ].filter((l, i, a) => l || a[i - 1]).join("\n"),
  });
}
