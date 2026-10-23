"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePlanner } from "@/lib/auth";
import {
  bulkApproveStockout, decideException, decideRecommendation, parseDecision, parseExceptionDecision, saveRules,
} from "@/lib/decisions";
import { runForecast } from "@/lib/rules/run";
import { getActiveRules } from "@/lib/settings";
import { rulesConfigSchema, type RulesConfig } from "@/lib/config/rules";
import { getUpload, isFileType, saveReport, saveUpload } from "@/lib/uploads";
import { loadFiles } from "@/lib/seed/loader";
import { FILE_SPECS, LOAD_ORDER } from "@/lib/seed/columns";
import { ensureDefaults } from "@/lib/settings";
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { TRACKER_ALERT_PCT, updateTracker } from "@/lib/tracker";
import { confirmMockPurchaseOrder, createDraftPOs, retryPurchaseOrder, saveVendorMap, syncStatuses } from "@/lib/purchase-orders";
import { notifyProcurement } from "@/lib/notify";

/**
 * Runs `fn`; on a validation error, comes back to `path` with the message instead of a crash page.
 * On success goes to `next()` if given, else back to `path` (with fn's message, if any).
 */
async function attempt(path: string, fn: () => Promise<string | void>, next?: () => string) {
  let msg: string | void;
  try {
    msg = await fn();
  } catch (err) {
    unstable_rethrow(err); // let Next's own redirects (e.g. to /login) through
    redirect(`${path}?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  revalidatePath("/", "layout");
  redirect(next ? next() : msg ? `${path}?ok=${encodeURIComponent(msg)}` : path);
}

export async function runForecastNow() {
  await attempt("/", async () => {
    await requirePlanner();
    const r = await runForecast("manual");
    return `Run #${r.runId}: ${r.counts.flagged} flagged, ${r.counts.exceptions} exceptions.`;
  });
}

export async function decide(formData: FormData) {
  await attempt("/review", async () => {
    const user = await requirePlanner();
    const d = parseDecision(String(formData.get("kind")), formData.get("qty"), formData.get("reason"));
    await decideRecommendation(Number(formData.get("id")), d, user);
  });
}

export async function bulkApprove(formData: FormData) {
  await attempt("/review", async () => {
    const user = await requirePlanner();
    if (formData.get("confirm") !== "yes") throw new Error("Tick the box to confirm you've reviewed the lines.");
    const ids = formData.getAll("ids").map(Number).filter(Number.isInteger);
    const n = await bulkApproveStockout(Number(formData.get("runId")), ids, user);
    return `Approved ${n} stockout line(s).`;
  });
}

export async function decideExceptionAction(formData: FormData) {
  await attempt("/exceptions", async () => {
    const user = await requirePlanner();
    const d = parseExceptionDecision(String(formData.get("kind")), formData.get("qty"), formData.get("note"));
    await decideException(Number(formData.get("id")), d, user);
  });
}

const num = (fd: FormData, k: string) => Number(fd.get(k));

export async function saveRulesAction(formData: FormData) {
  await attempt("/rules", async () => {
    const user = await requirePlanner();
    const current = (await getActiveRules()).config;
    const overrides: Record<string, boolean> = {};
    for (const [k, v] of formData.entries()) {
      if (!k.startsWith("perishable:")) continue;
      if (v === "yes") overrides[k.slice("perishable:".length)] = true;
      if (v === "no") overrides[k.slice("perishable:".length)] = false;
    }
    const next: RulesConfig = rulesConfigSchema.parse({
      festival: {
        months: formData.getAll("festivalMonths").map(Number),
        upliftMultiplier: 1 + num(formData, "upliftPct") / 100,
      },
      highDemand: {
        recentWeeks: current.highDemand.recentWeeks,
        baselineWeeks: current.highDemand.baselineWeeks,
        thresholdPct: num(formData, "thresholdPct"),
        orderMultiplier: num(formData, "orderMultiplier"),
      },
      cover: {
        standard: { minWeeks: num(formData, "stdMin"), maxWeeks: num(formData, "stdMax") },
        perishable: { minWeeks: num(formData, "perMin"), maxWeeks: num(formData, "perMax") },
      },
      exceptions: {
        minHistoryWeeks: num(formData, "minHistoryWeeks"),
        distributorConcentrationPct: num(formData, "distributorConcentrationPct"),
        wowSwingPct: num(formData, "wowSwingPct"),
      },
      perishableOverrides: overrides,
    });
    for (const [lo, hi, label] of [
      [next.cover.standard.minWeeks, next.cover.standard.maxWeeks, "standard"],
      [next.cover.perishable.minWeeks, next.cover.perishable.maxWeeks, "perishable"],
    ] as const)
      if (lo >= hi) throw new Error(`The ${label} minimum weeks must be below the maximum.`);
    if (JSON.stringify(next) === JSON.stringify(current)) throw new Error("Nothing changed.");
    const v = await saveRules(next, String(formData.get("note") ?? ""), user);
    return `Saved rules v${v}. They apply from the next run.`;
  });
}

export async function uploadCsv(formData: FormData) {
  let token = "";
  await attempt("/data", async () => {
    const user = await requirePlanner();
    const type = String(formData.get("type"));
    const file = formData.get("file");
    if (!isFileType(type)) throw new Error("Choose what the file contains.");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file.");
    if (!/\.csv$/i.test(file.name)) throw new Error("Upload a .csv file (save Excel sheets as CSV first).");
    token = (await saveUpload(type, file.name, Buffer.from(await file.arrayBuffer()), user.name)).token;
  }, () => `/data?upload=${token}`);
}

export async function loadUpload(formData: FormData) {
  const token = String(formData.get("token"));
  await attempt("/data", async () => {
    await requirePlanner();
    const up = await getUpload(token);
    if (!up) throw new Error("Upload expired — please upload the file again.");
    const overrides: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (k.startsWith("map:")) overrides[k.slice(4)] = String(v);
    const report = await loadFiles(
      { [up.meta.type]: up.csvPath },
      { source: "sap_csv", replace: false, overrides: { [up.meta.type]: overrides } },
    );
    if (report.blocked) throw new Error(`Not loaded: ${report.files[0]?.warnings.join(" ")}`);
    await saveReport(token, report);
  }, () => `/data?report=${token}`);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rupeesField = (fd: FormData, k: string) => {
  const v = Number(String(fd.get(k) ?? "").replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(v) || v < 0) throw new Error(`${k === "stockoutLoss" ? "Stockout loss" : "Overstock write-off"} must be a rupee amount ≥ 0.`);
  return v;
};

export async function saveMonthlyLoss(formData: FormData) {
  await attempt("/tracker", async () => {
    const user = await requirePlanner();
    const month = String(formData.get("month"));
    if (!MONTH.test(month)) throw new Error("Pick a month.");
    const row = {
      month,
      stockoutLoss: rupeesField(formData, "stockoutLoss"),
      overstockWriteoff: rupeesField(formData, "overstockWriteoff"),
      notes: String(formData.get("notes") ?? "").trim() || null,
      enteredBy: user.name,
      enteredAt: new Date(),
    };
    const db = await getDb();
    await db.insert(schema.monthlyLosses).values(row).onConflictDoUpdate({ target: schema.monthlyLosses.month, set: row });
    return `Saved losses for ${month}.`;
  });
}

export async function addIncident(formData: FormData) {
  await attempt("/tracker", async () => {
    const user = await requirePlanner();
    const date = String(formData.get("date"));
    const skuId = String(formData.get("skuId") ?? "").trim();
    if (!DATE.test(date) || !skuId) throw new Error("Date and SKU are required.");
    const units = Number(formData.get("units") || 0);
    const db = await getDb();
    const [sku] = await db.select().from(schema.skus).where(eq(schema.skus.skuId, skuId));
    if (!sku) throw new Error(`Unknown SKU "${skuId}".`);
    await db.insert(schema.stockoutIncidents).values({
      date, skuId, source: "manual", estLostUnits: units || null,
      estLostValue: units && sku.unitPrice != null ? units * sku.unitPrice : null,
      note: `${String(formData.get("note") ?? "").trim()} (${user.name})`.trim(),
    });
    return "Stockout recorded.";
  });
}

export async function addComplaint(formData: FormData) {
  await attempt("/tracker", async () => {
    const user = await requirePlanner();
    const note = String(formData.get("note") ?? "").trim();
    const date = String(formData.get("date"));
    if (!DATE.test(date) || note.length < 3) throw new Error("Date and a note are required.");
    const db = await getDb();
    await db.insert(schema.distributorComplaints).values({
      date, note, enteredBy: user.name,
      distributorId: String(formData.get("distributorId") ?? "").trim() || null,
      skuId: String(formData.get("skuId") ?? "").trim() || null,
    });
    return "Complaint recorded.";
  });
}

export async function refreshTracker() {
  await attempt("/tracker", async () => {
    await requirePlanner();
    const r = await updateTracker();
    return r.week ? `Tracker updated for week ${r.week}: ${r.rows} SKUs, ${r.alerts} off forecast by > ${TRACKER_ALERT_PCT}%, ${r.incidents} new stockout(s).` : "No sales data yet.";
  });
}

export async function createPOs() {
  await attempt("/purchase-orders", async () => {
    const user = await requirePlanner();
    const pos = await createDraftPOs(user);
    await notifyProcurement(pos, user.name);
    const failed = pos.filter((p) => p.status === "failed");
    if (failed.length === pos.length) throw new Error(`Zoho rejected every PO: ${failed[0]?.error}`);
    return `Created ${pos.length - failed.length} draft PO(s)${failed.length ? `; ${failed.length} failed — see below` : ""}. Procurement has been emailed.`;
  });
}

export async function retryPO(formData: FormData) {
  await attempt("/purchase-orders", async () => {
    const user = await requirePlanner();
    await retryPurchaseOrder(Number(formData.get("id")), user);
    return "Pushed again.";
  });
}

export async function confirmMockPO(formData: FormData) {
  await attempt("/purchase-orders", async () => {
    await requirePlanner();
    await confirmMockPurchaseOrder(Number(formData.get("id")));
    return "Marked as confirmed by procurement (mock).";
  });
}

export async function syncPOs() {
  await attempt("/purchase-orders", async () => {
    await requirePlanner();
    return `${await syncStatuses()} status change(s) from Zoho.`;
  });
}

export async function saveVendorMapAction(formData: FormData) {
  await attempt("/purchase-orders", async () => {
    const user = await requirePlanner();
    const map: Record<string, string> = {};
    for (const [k, v] of formData.entries()) if (k.startsWith("vendor:")) map[k.slice(7)] = String(v);
    await saveVendorMap(map, user);
    return "Saved supplier → Zoho vendor mapping.";
  });
}

/** Loads the five seed files shipped with the app (data/seed) — a full replace, like npm run seed. */
export async function loadSeedData(formData: FormData) {
  await attempt("/data", async () => {
    await requirePlanner();
    if (formData.get("confirm") !== "yes") throw new Error("Tick the box to confirm — this replaces the loaded sales, stock and masters.");
    const dir = path.join(process.cwd(), "data", "seed");
    const files = Object.fromEntries(
      LOAD_ORDER.map((t) => [t, path.join(dir, FILE_SPECS[t].defaultFile)]).filter(([, p]) => fs.existsSync(p)),
    );
    if (Object.keys(files).length < LOAD_ORDER.length) throw new Error("Seed files are missing from this deployment.");
    await ensureDefaults();
    const r = await loadFiles(files, {
      source: "seed",
      replace: true,
      placeholderPricesFile: path.join(process.cwd(), "data", "placeholder_prices.csv"),
    });
    const counts = r.files.map((f) => `${f.type} ${f.accepted}${f.rejected ? ` (${f.rejected} rejected)` : ""}`).join(", ");
    const failed = r.checks.filter((c) => !c.passed).map((c) => c.name);
    return `Loaded: ${counts}.${failed.length ? ` Check: ${failed.join("; ")}.` : " All checks passed."} Now run the forecast on the Overview.`;
  });
}
