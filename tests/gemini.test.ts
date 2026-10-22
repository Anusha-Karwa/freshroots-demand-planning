import { describe, expect, it } from "vitest";
import { mapLimit, parseReview, reviewFlag } from "@/lib/adapters/gemini";

describe("Gemini adapter", () => {
  it("accepts a well-formed reply", () => {
    expect(parseReview(JSON.stringify({ reason: "Sales are up 21% and stock covers 3.4 weeks.", unusual: false, unusualWhy: "" }))).toEqual({
      reason: "Sales are up 21% and stock covers 3.4 weeks.", unusual: false, unusualWhy: "",
    });
  });
  it("rejects malformed replies (caller falls back to the template)", () => {
    expect(parseReview(undefined)).toBeNull();
    expect(parseReview("not json")).toBeNull();
    expect(parseReview(JSON.stringify({ reason: "short" , unusual: false }))).toBeNull();
    expect(parseReview(JSON.stringify({ reason: "x".repeat(500), unusual: false }))).toBeNull();
  });
  it("ignores any quantity Gemini might add — only reason/unusual come through", () => {
    const r = parseReview(JSON.stringify({ reason: "Demand is up sharply this month.", unusual: true, unusualWhy: "Erratic.", recommendedQty: 9999 }));
    expect(r).not.toHaveProperty("recommendedQty");
  });
  it("returns the template and never routes in mock mode", async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await reviewFlag({ a: 1 }, "template text")).toEqual({ reason: "template text", unusual: false, unusualWhy: "", source: "template" });
  });
  it("mapLimit keeps order and the concurrency cap", async () => {
    let inFlight = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});
