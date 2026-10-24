import { describe, it, expect, beforeEach } from "vitest";
import { roleForPassword, safeEqual, signSession, verifySession } from "@/lib/auth/session";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.DASHBOARD_PASSWORD = "planner-pw";
  process.env.VIEWER_PASSWORD = "viewer-pw";
});

describe("session cookie", () => {
  it("round-trips and rejects tampering or expiry", async () => {
    const token = await signSession({ name: "Raghav", role: "planner" });
    expect(await verifySession(token)).toMatchObject({ name: "Raghav", role: "planner" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ name: "X", role: "planner", exp: Date.now() + 1e9 })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`)).toBeNull();
    expect(await verifySession(`${body}.x${sig.slice(1)}`)).toBeNull();
    expect(await verifySession(token, Date.now() + 15 * 86_400_000)).toBeNull();
    process.env.AUTH_SECRET = "rotated";
    expect(await verifySession(token)).toBeNull();
  });
  it("maps passwords to roles", () => {
    expect(roleForPassword("planner-pw")).toBe("planner");
    expect(roleForPassword("viewer-pw")).toBe("viewer");
    expect(roleForPassword("nope")).toBeNull();
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
