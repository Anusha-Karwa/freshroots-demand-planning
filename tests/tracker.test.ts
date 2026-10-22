import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.GEMINI_API_KEY;

const { loadFiles } = await import("@/lib/seed/loader");
const { runForecast } = await import("@/lib/rules/run");
const { updateTracker, latestTracker, decisionsByRun } = await import("@/lib/tracker");
const { closeDb, getDb, schema } = await import("@/lib/db");
const { ensureDefaults } = await import("@/lib/settings");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-test-"));
const write = (name: string, body: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body.trim() + "\n");
  return p;
};
const weeks = (sku: string, units: number[]) => units.map((u, i) => `${sku},2026-W${String(27 + i).padStart(2, "0")},${u}`).join("\n");

beforeAll(async () => {
  await ensureDefaults();
  await loadFiles(
    {
      calendar: write("cal.csv", `Year,Month,Is_Festival_Month\n2026,6,FALSE\n2026,7,FALSE\n2026,8,FALSE\n2026,9,FALSE\n2026,10,TRUE\n2026,11,TRUE`),
      skus: write("skus.csv", `SKU_ID,SKU_Name,Perishability,Standard_Reorder_Qty\nA,Atta,Low,100\nB,Bread,High,50`),
      distributors: write("d.csv", `Distributor_ID,Distributor_Name\nD1,One`),
      // A steady at 100 then +20% vs its festival forecast; B steady at 40 then a drop to 30
      weekly_sales: write("s.csv", `SKU_ID,Week,Units_Sold\n${weeks("A", [...Array(15).fill(100), 150])}\n${weeks("B", [...Array(15).fill(40), 30])}`),
      inventory: write("i.csv", `SKU_ID,Units_On_Hand,As_Of_Date\nA,0,2026-10-19\nB,100,2026-10-19`),
    },
    { source: "seed", replace: true },
  );
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("forecast run (mock Gemini) + tracker", () => {
  it("saves every SKU's forecast and template reasons", async () => {
    const r = await runForecast("manual");
    expect(r.counts.reasonSource).toBe("template");
    expect(r.counts.aiRouted).toBe(0);
    const db = await getDb();
    const f = await db.select().from(schema.runForecasts);
    expect(f.map((x) => x.skuId).sort()).toEqual(["A", "B"]);
    expect(f.every((x) => x.planningWeek === "2026-10-19")).toBe(true);
  });

  it("compares the latest week with a replayed forecast when no run planned it", async () => {
    const r = await updateTracker("2026-10-22");
    expect(r).toMatchObject({ week: "2026-10-12", rows: 2, alerts: 1 });
    const t = await latestTracker();
    const a = t.rows.find((x) => x.skuId === "A")!;
    // the week of 12 Oct is in October (festival): forecast = 100 × 1.25 = 125, actual 150 → +20%
    expect(a).toMatchObject({ forecastSource: "replayed", forecastUnits: 125, actualUnits: 150, deviationPct: 20 });
    const b = t.rows.find((x) => x.skuId === "B")!;
    expect(b.deviationPct).toBe(-40); // 30 vs 50 → past the 25% alert line (A at +20% is not)
  });

  it("detects a stockout once (selling SKU with zero stock)", async () => {
    const db = await getDb();
    let inc = await db.select().from(schema.stockoutIncidents);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ skuId: "A", date: "2026-10-19", source: "detected" });
    await updateTracker("2026-10-23");
    inc = await db.select().from(schema.stockoutIncidents);
    expect(inc).toHaveLength(1);
  });

  it("counts overrides per run for the kill switch", async () => {
    const db = await getDb();
    const [rec] = await db.select().from(schema.recommendations);
    await db.update(schema.recommendations).set({ status: "rejected", decidedBy: "t", decidedAt: new Date() });
    const runs = await decisionsByRun();
    expect(runs[0]).toMatchObject({ runId: rec.runId, overridden: runs[0].decided });
  });
});
