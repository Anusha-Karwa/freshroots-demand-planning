import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: async () => ({ insert: () => ({ values: async () => undefined }) }), schema: { zohoApiLog: {} } }));
const { accessToken, resetZohoTokenCache, toZohoPayload, zohoRequest } = await import("@/lib/adapters/zoho");
const { cronAuthorized } = await import("@/lib/cron");

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  resetZohoTokenCache();
  Object.assign(process.env, {
    ZOHO_CLIENT_ID: "id", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh", ZOHO_ORGANIZATION_ID: "60001",
    ZOHO_ACCOUNTS_URL: "https://accounts.zoho.in", ZOHO_API_BASE: "https://www.zohoapis.in/inventory/v1",
  });
});

describe("Zoho client", () => {
  it("caches the access token until a minute before expiry", async () => {
    const f = vi.fn(async () => json(200, { access_token: "tok-1", expires_in: 3600 }));
    expect(await accessToken(f as never, 0)).toBe("tok-1");
    expect(await accessToken(f as never, 3_000_000)).toBe("tok-1");
    expect(f).toHaveBeenCalledTimes(1);
    f.mockImplementation(async () => json(200, { access_token: "tok-2", expires_in: 3600 }));
    expect(await accessToken(f as never, 3_550_000)).toBe("tok-2");
  });

  it("explains a failed token refresh", async () => {
    const f = async () => json(400, { error: "invalid_client" });
    await expect(accessToken(f as never)).rejects.toThrow(/invalid_client.*\.in data centre/);
  });

  it("adds the org id, retries a 429 and returns the body", async () => {
    const calls: string[] = [];
    let n = 0;
    const f = async (url: string) => {
      calls.push(url);
      if (url.includes("oauth")) return json(200, { access_token: "t", expires_in: 3600 });
      return ++n === 1 ? json(429, { code: 1, message: "rate limited" }) : json(201, { code: 0, message: "created", purchaseorder: { purchaseorder_id: "9" } });
    };
    const r = await zohoRequest<{ purchaseorder: { purchaseorder_id: string } }>("POST", "/purchaseorders", {}, { f: f as never, retryDelayMs: 1 });
    expect(r.purchaseorder.purchaseorder_id).toBe("9");
    expect(calls.filter((u) => u.includes("purchaseorders"))).toHaveLength(2);
    expect(calls[1]).toBe("https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=60001");
  });

  it("throws Zoho's own message on a business error", async () => {
    const f = async (url: string) =>
      url.includes("oauth") ? json(200, { access_token: "t" }) : json(400, { code: 1002, message: "Vendor does not exist." });
    await expect(zohoRequest("POST", "/purchaseorders", {}, { f: f as never })).rejects.toThrow(/code 1002\): Vendor does not exist/);
  });

  it("builds a draft PO payload with item ids where known", () => {
    const p = toZohoPayload({
      vendorId: "V1", referenceNumber: "FR-PO-1", date: "2026-10-22", notes: "n",
      lines: [{ skuId: "A", zohoItemId: "I-1", name: "Atta", quantity: 5, rate: 10 }, { skuId: "B", name: "Bread", quantity: 2, rate: 3 }],
    });
    expect(p.line_items).toEqual([
      { item_id: "I-1", description: "A", quantity: 5, rate: 10 },
      { name: "Bread", description: "B", quantity: 2, rate: 3 },
    ]);
    expect(p).not.toHaveProperty("status");
  });
});

describe("cron auth", () => {
  it("needs the bearer secret when CRON_SECRET is set", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized("Bearer s3cret")).toBe(true);
    expect(cronAuthorized("Bearer nope")).toBe(false);
    expect(cronAuthorized(null)).toBe(false);
  });
  it("without a secret, only answers outside production", () => {
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(null)).toBe(true); // vitest runs with NODE_ENV=test
  });
});
