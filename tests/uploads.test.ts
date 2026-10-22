import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { saveUpload, getUpload, saveReport, getReport } = await import("@/lib/uploads");
const { closeDb } = await import("@/lib/db");
afterAll(closeDb);

describe("uploads", () => {
  it("round-trips a CSV through the database and back to a readable file", async () => {
    const meta = await saveUpload("inventory", "stock.csv", Buffer.from("sku_id,stock_on_hand\nA,5\n"), "Raghav");
    const up = await getUpload(meta.token);
    expect(up?.meta).toMatchObject({ type: "inventory", fileName: "stock.csv", uploadedBy: "Raghav" });
    expect(fs.readFileSync(up!.csvPath, "utf8")).toBe("sku_id,stock_on_hand\nA,5\n");
    await saveReport(meta.token, { files: [], checks: [], blocked: false });
    expect(await getReport(meta.token)).toEqual({ files: [], checks: [], blocked: false });
  });
  it("rejects malformed tokens (no path tricks)", async () => {
    expect(await getUpload("../../etc/passwd")).toBeNull();
    expect(await getReport("nope")).toBeNull();
  });
});
