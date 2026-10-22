import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { sendEmail } from "@/lib/adapters/email";
import type { killSwitch, Status } from "@/lib/killswitch";
import type { RunSummary } from "@/lib/rules/run";
import type { CreatedPo } from "@/lib/purchase-orders";
import { rupees } from "@/lib/ui/format";

const link = (path: string) => `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}${path}`;

/** After a forecast run: "N items awaiting your call". Skipped when nothing needs Raghav. */
export async function notifyPlanner(run: RunSummary) {
  const n = run.counts.flagged + run.counts.exceptions;
  if (!n) return null;
  const byFlag = Object.entries(run.counts.byFlag).map(([f, c]) => `${f.replace("_", " ").toLowerCase()}: ${c}`).join(", ");
  return sendEmail({
    to: process.env.PLANNER_EMAIL || "Raghav (PLANNER_EMAIL not set)",
    subject: `${n} item${n === 1 ? "" : "s"} awaiting your call — Freshroots run #${run.runId}`,
    text: [
      `Raghav,`,
      ``,
      `Run #${run.runId} (data as of ${run.dataAsOf}, planning the week of ${run.planningWeek}) flagged ${run.counts.flagged} SKU(s)${byFlag ? ` (${byFlag})` : ""} and sent ${run.counts.exceptions} to your exceptions queue.`,
      ``,
      `Review queue: ${link("/review")}`,
      `Exceptions:   ${link("/exceptions")}`,
      ``,
      `Nothing is ordered until you approve it.`,
    ].join("\n"),
  });
}

/** After draft POs are created: tell procurement what to confirm in Zoho. */
export async function notifyProcurement(pos: CreatedPo[], by: string) {
  const ok = pos.filter((p) => p.status !== "failed");
  if (!ok.length) return null;
  return sendEmail({
    to: process.env.PROCUREMENT_EMAIL || "Procurement (PROCUREMENT_EMAIL not set)",
    subject: `${ok.length} draft purchase order${ok.length === 1 ? "" : "s"} ready to confirm in Zoho`,
    text: [
      `Approved by ${by}. Please review and confirm in Zoho Inventory:`,
      ``,
      ...ok.map((p) => `• ${p.number} — supplier ${p.supplierId}, ${p.lines} line(s), ${rupees(p.totalValue)}`),
      ``,
      `Details: ${link("/purchase-orders")}`,
    ].join("\n"),
  });
}

/** Emails Deepa when the kill switch turns red (only on the change, not every day it stays red). */
export async function notifyKillSwitch(k: ReturnType<typeof killSwitch>) {
  const db = await getDb();
  const [prev] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "killswitch_last"));
  const last = (prev?.value as { status?: Status } | undefined)?.status;
  await db
    .insert(schema.appSettings)
    .values({ key: "killswitch_last", value: { status: k.overall }, updatedBy: "tracker" })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: { status: k.overall }, updatedAt: new Date() } });
  if (k.overall !== "red" || last === "red") return null;
  const reason = k.early.status === "red"
    ? `Raghav edited or rejected ${k.early.ratePct}% of recommendations over the last ${k.early.runsCounted} runs (limit ${k.early.limitPct}%). Action: halt and re-evaluate the rules.`
    : `Monthly losses were above ${rupees(k.outcome.limit)} for 2 months running (latest ${k.outcome.latest?.month}: ${rupees(k.outcome.latest?.total ?? 0)}). Action: stop, run a root-cause analysis, fix, redeploy.`;
  return sendEmail({
    to: process.env.VIEWER_EMAIL || "Deepa (VIEWER_EMAIL not set)",
    subject: "Freshroots demand planning: kill switch is RED",
    text: `Deepa,\n\n${reason}\n\nTracker: ${link("/tracker")}`,
  });
}

export async function recentEmails(limit = 15) {
  const db = await getDb();
  return db.select().from(schema.mockEmails).orderBy(desc(schema.mockEmails.id)).limit(limit);
}
