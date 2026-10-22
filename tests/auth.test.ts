import { describe, expect, it, beforeEach } from "vitest";
import { decodeSession, encodeSession, roleForPassword } from "@/lib/auth";

beforeEach(() => {
  process.env.DASHBOARD_PASSWORD = "planner-pass";
  process.env.VIEWER_PASSWORD = "viewer-pass";
  process.env.AUTH_SECRET = "test-secret";
});

describe("auth", () => {
  it("maps passwords to roles", () => {
    expect(roleForPassword("planner-pass")).toBe("planner");
    expect(roleForPassword("viewer-pass")).toBe("viewer");
    expect(roleForPassword("nope")).toBeNull();
  });

  it("round-trips a signed session", () => {
    const v = encodeSession({ name: "Raghav", role: "planner" });
    expect(decodeSession(v)).toEqual({ name: "Raghav", role: "planner" });
  });

  it("rejects a tampered session (e.g. viewer → planner)", () => {
    const v = encodeSession({ name: "Deepa", role: "viewer" });
    const [, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ name: "Deepa", role: "planner", exp: Date.now() + 1e6 })).toString("base64url");
    expect(decodeSession(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired session", () => {
    const v = encodeSession({ name: "Raghav", role: "planner" }, Date.now() - 15 * 86_400_000);
    expect(decodeSession(v)).toBeNull();
  });
});
