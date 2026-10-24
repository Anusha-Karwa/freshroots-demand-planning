import { describe, it, expect, afterEach } from "vitest";
import { explainFlags, parseReply } from "@/lib/adapters/gemini";

describe("Gemini reply validation", () => {
  it("accepts the expected JSON", () => {
    const r = parseReply(JSON.stringify({ items: [{ skuId: "SKU1", reason: "Sales are up 27% on the 12-week average.", unusual: false, note: "" }] }));
    expect(r?.[0].skuId).toBe("SKU1");
  });
  it("rejects malformed or truncated replies", () => {
    expect(parseReply('{"items":[{"skuId":"SKU1","reason":"Sales are')).toBeNull();
    expect(parseReply(JSON.stringify({ items: [{ skuId: "SKU1" }] }))).toBeNull();
    expect(parseReply(undefined)).toBeNull();
  });
});

describe("mock mode", () => {
  const key = process.env.GEMINI_API_KEY;
  afterEach(() => { process.env.GEMINI_API_KEY = key; });
  it("uses the template reasons and routes nothing", async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await explainFlags([{ skuId: "SKU1", name: "x", category: null, flags: ["STOCKOUT_RISK"], exceptions: [], metrics: {}, template: "Stock covers 2 weeks.", context: [] }]);
    expect(r.source).toBe("template");
    expect(r.results[0]).toEqual({ skuId: "SKU1", reason: "Stock covers 2 weeks.", unusual: false, note: "", source: "template" });
  });
});
