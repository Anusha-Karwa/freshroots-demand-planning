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
