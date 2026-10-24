import { describe, it, expect } from "vitest";
import { classify } from "@/lib/tracker";

describe("daily early warning", () => {
  it("flags actuals beyond ±25% of forecast", () => {
    expect(classify(100, 100, 500, 25)).toEqual({ status: "on_track", variancePct: 0 });
    expect(classify(126, 100, 500, 25).status).toBe("above");
    expect(classify(125, 100, 500, 25).status).toBe("on_track");
    expect(classify(70, 100, 500, 25).status).toBe("below");
  });
  it("calls zero stock with demand a stockout", () => {
    expect(classify(0, 100, 0, 25).status).toBe("stockout");
    expect(classify(0, 0, 0, 25).status).toBe("on_track");
  });
  it("handles sales with no forecast", () => {
    expect(classify(10, 0, 50, 25)).toEqual({ status: "above", variancePct: null });
  });
});
