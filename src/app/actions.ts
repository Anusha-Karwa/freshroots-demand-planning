"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requirePlanner } from "@/lib/auth";
import { COOKIE, roleForPassword, SESSION_DAYS, signSession } from "@/lib/auth/session";
import { pingGemini } from "@/lib/adapters/gemini";
import { liveClient } from "@/lib/adapters/zoho";
import { sendEmail } from "@/lib/adapters/email";
import { FILE_KINDS, type ColumnMap, type FileKind } from "@/lib/data/columns";
import { loadCsv, loadSeed, type LoadSummary } from "@/lib/data/load";
import { readCsv } from "@/lib/data/parse";
import { bulkApproveStockouts, decide, type Decision } from "@/lib/decisions";
import { runForecast } from "@/lib/forecast/run";
import { mode } from "@/lib/integrations";
import { notifyPlanner } from "@/lib/notify";
import { createPurchaseOrders, retryPurchaseOrder, simulateProcurementConfirm } from "@/lib/purchase-orders";
import { rulesConfigSchema, type RulesConfig } from "@/lib/rules/config";
import { baselineSchema, getRules, getVendorMap, writeSetting } from "@/lib/settings";
import { runTracker } from "@/lib/tracker";

/**
 * Every form posts to one of these. Each one checks the planner role, does the work, and redirects back with a
 * ?msg= or ?err= banner (so the pages work without client-side JavaScript).
 */

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const number = (fd: FormData, k: string) => {
  const s = text(fd, k).replace(/[₹,\s]/g, "");
  return s === "" ? null : Number(s);
};
const safePath = (p: string) => (p.startsWith("/") && !p.startsWith("//") ? p : "/");

function withBanner(path: string, key: "msg" | "err", value: string) {
  const [base, query = ""] = path.split("?");
  const qs = new URLSearchParams(query);
  qs.delete("msg");
  qs.delete("err");
  qs.set(key, value.slice(0, 400));
  return `${base}?${qs.toString()}`;
}

/** Runs fn and redirects to path with its message, or with the error. redirect() must stay outside the try. */
async function attempt(path: string, fn: () => Promise<string | void>) {
  let target: string;
  try {
    const msg = await fn();
    target = msg ? withBanner(path, "msg", msg) : path;
  } catch (err) {
    target = withBanner(path, "err", err instanceof Error ? err.message : String(err));
  }
  redirect(target);
}

// ---------------- Auth ----------------

export async function login(fd: FormData) {
  const name = text(fd, "name");
  const role = roleForPassword(text(fd, "password"));
  const next = safePath(text(fd, "next") || "/");
  if (!name) redirect(`/login?err=${encodeURIComponent("Enter your name (it goes in the decision log).")}`);
  if (!role) redirect(`/login?err=${encodeURIComponent("Wrong password.")}&next=${encodeURIComponent(next)}`);
  (await cookies()).set(COOKIE, await signSession({ name, role }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  redirect(next);
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

// ---------------- Forecast run & decisions ----------------

export async function runForecastNow() {
  await requirePlanner();
  await attempt("/", async () => {
    const db = await getDb();
    const r = await runForecast(db, { trigger: "manual" });
    await notifyPlanner(db, r);
    const ai = r.reasonSource === "gemini" ? "Gemini" : "template";
    return `Run #${r.runId} done: ${r.counts.review} to review, ${r.counts.exceptions} exceptions (reasons: ${ai}).${r.geminiErrors.length ? ` Gemini error: ${r.geminiErrors[0]}` : ""}`;
  });
}

export async function decideAction(fd: FormData) {
  const s = await requirePlanner();
  const back = safePath(text(fd, "back") || "/review");
  await attempt(back, async () => {
    const r = await decide(await getDb(), {
      itemId: Number(text(fd, "itemId")),
      decision: text(fd, "decision") as Decision,
      qty: number(fd, "qty"),
      reason: text(fd, "reason"),
      by: s.name,
    });
    return `${text(fd, "skuId")}: ${r.decision}${r.decision !== "rejected" ? ` (${r.finalQty})` : ""}.`;
  });
}

export async function bulkApproveAction(fd: FormData) {
  const s = await requirePlanner();
  await attempt("/review", async () => {
    const n = await bulkApproveStockouts(await getDb(), {
      itemIds: fd.getAll("itemId").map(Number), reviewed: fd.get("reviewed") === "on", by: s.name,
    });
    return `Approved ${n} stockout-risk line(s).`;
  });
}

// ---------------- Purchase orders ----------------

export async function createPurchaseOrdersAction() {
  const s = await requirePlanner();
  await attempt("/purchase-orders", async () => {
    const r = await createPurchaseOrders(await getDb(), s.name);
    if (!r.created && !r.failed) return "Nothing to order: no approved lines with a quantity above 0.";
    return `${r.created} draft PO(s) created${mode("zoho") === "mock" ? " (MOCK)" : " in Zoho"}${r.failed ? `, ${r.failed} failed — see below` : ""}.`;
  });
}

export async function retryPurchaseOrderAction(fd: FormData) {
  await requirePlanner();
  await attempt("/purchase-orders", async () => {
    const ok = await retryPurchaseOrder(await getDb(), Number(text(fd, "poId")));
    if (!ok) throw new Error("Retry failed again — see the error on the PO.");
    return "Purchase order created.";
  });
}

export async function confirmMockPurchaseOrder(fd: FormData) {
  await requirePlanner();
  await attempt("/purchase-orders", async () => {
    await simulateProcurementConfirm(await getDb(), Number(text(fd, "poId")));
    return "Marked as issued (simulating procurement confirming in Zoho).";
  });
}

export async function saveVendorMap(fd: FormData) {
  const s = await requirePlanner();
  await attempt("/purchase-orders", async () => {
    const db = await getDb();
    const map = await getVendorMap(db);
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("vendor:")) continue;
      const supplier = k.slice(7);
      const id = String(v).trim();
      if (id) map[supplier] = id;
      else delete map[supplier];
    }
    await writeSetting(db, "vendor_map", map, s.name);
    return "Supplier → Zoho vendor map saved.";
  });
}

// ---------------- Rules & baseline ----------------

export async function saveRules(fd: FormData) {
  const s = await requirePlanner();
  await attempt("/rules", async () => {
    const db = await getDb();
    const current = (await getRules(db)).config;
    const months = fd.getAll("festivalMonths").map(Number);
    const overrides: Record<string, boolean> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("perishable:")) continue;
      const choice = String(v);
      if (choice === "yes") overrides[k.slice(11)] = true;
      if (choice === "no") overrides[k.slice(11)] = false;
    }
    const n = (k: keyof RulesConfig) => number(fd, k) ?? (current[k] as number);
    const next = {
      festivalMonths: months, festivalUpliftPct: n("festivalUpliftPct"), highDemandPct: n("highDemandPct"),
      highDemandOrderMultiplier: n("highDemandOrderMultiplier"), shortWindowWeeks: n("shortWindowWeeks"), longWindowWeeks: n("longWindowWeeks"),
      minCoverWeeks: n("minCoverWeeks"), maxCoverWeeks: n("maxCoverWeeks"), perishableMinCoverWeeks: n("perishableMinCoverWeeks"),
      perishableMaxCoverWeeks: n("perishableMaxCoverWeeks"), newSkuMinWeeks: n("newSkuMinWeeks"), wowSwingPct: n("wowSwingPct"),
      distributorSharePct: n("distributorSharePct"), distributorMinChangePct: n("distributorMinChangePct"), perishableOverrides: overrides,
    };
    const parsed = rulesConfigSchema.safeParse(next);
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || "rules"}: ${i.message}`).join("; "));
    if (JSON.stringify(parsed.data) === JSON.stringify(current)) return "No changes.";
    const note = text(fd, "note");
    if (!note) throw new Error("Say why you are changing the rules (it is kept in the version history).");
    const [row] = await db.insert(schema.rulesVersions).values({ config: parsed.data, createdBy: s.name, note }).returning();
    return `Saved as rules version ${row.id}. The next run uses it.`;
  });
}

export async function saveBaseline(fd: FormData) {
  const s = await requirePlanner();
  await attempt("/rules", async () => {
    const values: Record<string, number | null> = {};
    for (const key of Object.keys(baselineSchema.shape)) values[key] = number(fd, key);
    const lakhs = ["stockoutLossQuarterLow", "stockoutLossQuarterHigh", "overstockQuarterLow", "overstockQuarterHigh", "buildCost", "outcomeMonthlyLimit"];
    for (const k of lakhs) if (values[k] != null) values[k] = values[k]! * 100_000;
    const parsed = baselineSchema.safeParse(values);
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    await writeSetting(await getDb(), "baseline", parsed.data, s.name);
    return "Baseline and kill-switch thresholds saved.";
  });
}

// ---------------- Tracker ----------------

export async function saveMonthlyLoss(fd: FormData) {
  const s = await requirePlanner();
  await attempt("/tracker", async () => {
    const ym = text(fd, "yearMonth");
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("Pick a month.");
    const stockout = number(fd, "stockoutLoss");
    const overstock = number(fd, "overstockWriteoff");
    if (stockout == null || overstock == null || stockout < 0 || overstock < 0) throw new Error("Enter both ₹ amounts (0 or more).");
    const complaints = number(fd, "distributorComplaints");
    const values = {
      yearMonth: ym, stockoutLoss: stockout, overstockWriteoff: overstock,
      distributorComplaints: complaints == null ? null : Math.round(complaints), note: text(fd, "note") || null, enteredBy: s.name,
    };
    await (await getDb()).insert(schema.monthlyLosses).values(values)
      .onConflictDoUpdate({ target: schema.monthlyLosses.yearMonth, set: { ...values, updatedAt: new Date() } });
    return `Losses for ${ym} saved.`;
  });
}

export async function deleteMonthlyLoss(fd: FormData) {
  await requirePlanner();
  await attempt("/tracker", async () => {
    await (await getDb()).delete(schema.monthlyLosses).where(eq(schema.monthlyLosses.yearMonth, text(fd, "yearMonth")));
    return "Month removed.";
  });
}

export async function addIncident(fd: FormData) {
  await requirePlanner();
  await attempt("/tracker", async () => {
    const skuId = text(fd, "skuId");
    const week = text(fd, "weekStart");
    if (!skuId || !week) throw new Error("Pick a SKU and a week.");
    await (await getDb()).insert(schema.stockoutIncidents).values({
      skuId, weekStart: week, source: "manual", lostUnits: number(fd, "lostUnits"), lostValue: number(fd, "lostValue"), note: text(fd, "note") || null,
    });
    return "Stockout incident added.";
  });
}

export async function runTrackerNow() {
  await requirePlanner();
  await attempt("/tracker", async () => {
    const r = await runTracker(await getDb());
    return `Checked ${r.checked} SKU(s) for the week of ${r.week ?? "—"} (forecast from ${r.forecastSource || "—"}); ${r.incidents} new stockout incident(s); kill switch ${r.killSwitch}.`;
  });
}

// ---------------- Data ----------------

export async function loadSeedAction() {
  const s = await requirePlanner();
  await attempt("/data", async () => {
    const summaries = await loadSeed(await getDb(), s.name);
    return describeLoads(summaries);
  });
}

function describeLoads(summaries: LoadSummary[]) {
  return summaries.map((x) => `${FILE_KINDS[x.kind].label}: ${x.accepted} loaded${x.rejected.length ? `, ${x.rejected.length} rejected` : ""}${x.missingColumns.length ? ` — missing ${x.missingColumns.join(", ")}` : ""}`).join(" · ");
}

/** Step 1: keep the uploaded CSV in the database and show the column-mapping step. */
export async function uploadCsv(fd: FormData) {
  const s = await requirePlanner();
  const kind = text(fd, "kind") as FileKind;
  const file = fd.get("file");
  let target = "/data";
  try {
    if (!(kind in FILE_KINDS)) throw new Error("Pick what the file contains.");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a CSV file.");
    if (!/\.(csv|txt)$/i.test(file.name)) throw new Error("Save the SAP/Excel export as CSV first (File → Save As → CSV UTF-8).");
    const content = await file.text();
    const { headers, rows } = readCsv(content);
    if (!headers.length || !rows.length) throw new Error("The file has no header row or no data rows.");
    const db = await getDb();
    await db.delete(schema.uploads).where(lt(schema.uploads.createdAt, new Date(Date.now() - 7 * 86_400_000)));
    const [row] = await db.insert(schema.uploads).values({ kind, filename: file.name, content, createdBy: s.name }).returning();
    target = `/data?upload=${row.id}`;
  } catch (err) {
    target = withBanner("/data", "err", err instanceof Error ? err.message : String(err));
  }
  redirect(target);
}

/** Step 2: load the uploaded CSV with the confirmed column mapping (adds to / updates existing data). */
export async function confirmUpload(fd: FormData) {
  const s = await requirePlanner();
  const id = Number(text(fd, "uploadId"));
  await attempt(`/data`, async () => {
    const db = await getDb();
    const [up] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
    if (!up) throw new Error("Upload not found (uploads are kept for 7 days). Upload the file again.");
    const kind = up.kind as FileKind;
    const map: ColumnMap = {};
    for (const f of FILE_KINDS[kind].fields) map[f.field] = text(fd, `map:${f.field}`) || null;
    const summary = await loadCsv(db, kind, up.content, { map, mode: "merge", by: s.name, source: "sap_upload", filename: up.filename });
    if (summary.missingColumns.length) throw new Error(`Map these columns first: ${summary.missingColumns.join(", ")}`);
    await db.delete(schema.uploads).where(eq(schema.uploads.id, id));
    const rejected = summary.rejected.slice(0, 5).map((r) => `row ${r.row}: ${r.reason}`).join("; ");
    return `${up.filename}: ${summary.accepted} of ${summary.rows} rows loaded.${summary.rejected.length ? ` ${summary.rejected.length} rejected (${rejected}${summary.rejected.length > 5 ? "…" : ""}).` : ""}${summary.warnings.length ? ` Note: ${summary.warnings.join(" ")}` : ""}`;
  });
}

export async function cancelUpload(fd: FormData) {
  await requirePlanner();
  await (await getDb()).delete(schema.uploads).where(eq(schema.uploads.id, Number(text(fd, "uploadId"))));
  redirect("/data");
}

export async function addMarketEvent(fd: FormData) {
  const s = await requirePlanner();
  await attempt("/data", async () => {
    const start = text(fd, "startDate");
    const end = text(fd, "endDate") || start;
    const description = text(fd, "description");
    if (!description || !/^\d{4}-\d{2}-\d{2}$/.test(start) || end < start) throw new Error("Enter a description and a valid date range.");
    await (await getDb()).insert(schema.marketEvents).values({
      kind: text(fd, "kind") || "competitor_scheme", description, startDate: start, endDate: end,
      skuId: text(fd, "skuId") || null, category: text(fd, "category") || null, createdBy: s.name,
    });
    return "Market event added. Gemini sees it in the next run.";
  });
}

export async function deleteMarketEvent(fd: FormData) {
  await requirePlanner();
  await attempt("/data", async () => {
    await (await getDb()).delete(schema.marketEvents).where(eq(schema.marketEvents.id, Number(text(fd, "id"))));
    return "Market event removed.";
  });
}

// ---------------- Integrations ----------------

export async function testIntegration(fd: FormData) {
  const s = await requirePlanner();
  const service = text(fd, "service");
  await attempt("/integrations", async () => {
    const db = await getDb();
    switch (service) {
      case "database": {
        const [r] = await db.select({ n: schema.skus.id }).from(schema.skus).limit(1);
        return `Database OK${r ? "" : " (no SKUs loaded yet)"}.`;
      }
      case "gemini": {
        if (mode("gemini") !== "live") return "Gemini is in mock mode (GEMINI_API_KEY not set).";
        return `Gemini replied: “${await pingGemini()}”.`;
      }
      case "zoho": {
        if (mode("zoho") !== "live") return "Zoho is in mock mode (Zoho keys not set).";
        const orgs = await liveClient(db).organizations();
        const mine = orgs.find((o) => o.organization_id === process.env.ZOHO_ORGANIZATION_ID?.trim());
        if (!mine) throw new Error(`Connected, but ZOHO_ORGANIZATION_ID is not among your organisations: ${orgs.map((o) => `${o.name} (${o.organization_id})`).join(", ") || "none"}.`);
        return `Zoho OK: organisation “${mine.name}”.`;
      }
      case "email": {
        const r = await sendEmail(db, {
          to: process.env.PLANNER_EMAIL, subject: "Freshroots demand planning — test email",
          text: `Test email sent by ${s.name} from the Integrations page.`,
        });
        if (r.status === "failed") throw new Error(`Resend error: ${r.detail}`);
        return r.status === "mock" ? "Email is in mock mode: logged to mock_emails." : r.status === "skipped" ? "PLANNER_EMAIL is not set." : `Sent to ${process.env.PLANNER_EMAIL}.`;
      }
      default:
        throw new Error("Unknown service.");
    }
  });
}
