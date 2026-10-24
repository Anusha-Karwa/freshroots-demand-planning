import { describe, it, expect } from "vitest";
import { ZohoClient, ZohoError } from "@/lib/adapters/zoho";

/** A fake Zoho server: scripted responses per call, and a record of what was sent. */
function fakeZoho(script: ((url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> })[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const step = script.shift();
    if (!step) throw new Error(`unexpected call ${url}`);
    const r = step(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  const logs: string[] = [];
  const client = new ZohoClient(
    { clientId: "id", clientSecret: "secret", refreshToken: "rt", orgId: "ORG1", accountsUrl: "https://accounts.zoho.in", apiBase: "https://www.zohoapis.in/inventory/v1" },
    async (e) => { logs.push(`${e.method} ${e.path} ${e.status}`); },
    fetcher,
    async () => undefined,
  );
  return { client, calls, logs };
}

const token = (value = "AT1") => () => ({ status: 200, body: { access_token: value, expires_in: 3600 } });
const po = () => () => ({ status: 201, body: { code: 0, message: "created", purchaseorder: { purchaseorder_id: "PO9", purchaseorder_number: "PO-00009", status: "draft" } } });

const input = {
  vendorId: "V1", date: "2026-10-24", reference: "FR-RUN1-PO1", notes: "n",
  lines: [{ skuId: "SKU001", name: "Mango", unit: "Units", qty: 750, rate: 14, zohoItemId: "I1" }],
};

describe("Zoho client", () => {
  it("refreshes a token, creates a draft PO, and caches the token", async () => {
    const { client, calls, logs } = fakeZoho([token(), po(), po()]);
    const r = await client.createDraftPurchaseOrder(input);
    expect(r).toEqual({ id: "PO9", number: "PO-00009", status: "draft", itemIds: { SKU001: "I1" } });
    expect(calls[0].url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token");
    expect(calls[1].url).toBe("https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=ORG1");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken AT1");
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.vendor_id).toBe("V1");
    expect(body.line_items).toEqual([{ item_id: "I1", quantity: 750, rate: 14, description: "SKU001 Mango" }]);
    expect(body).not.toHaveProperty("status"); // never marked issued/open
    await client.createDraftPurchaseOrder(input);
    expect(calls.filter((c) => c.url.includes("oauth")).length).toBe(1);
    expect(logs).toContain("POST /purchaseorders 201");
  });

  it("retries after a 429 and re-authenticates once after a 401", async () => {
    const { client, calls } = fakeZoho([
      token("AT1"),
      () => ({ status: 429, body: { code: 1070, message: "rate limited" }, headers: { "retry-after": "1" } }),
      () => ({ status: 401, body: { code: 57, message: "expired" } }),
      token("AT2"),
      po(),
    ]);
    const r = await client.createDraftPurchaseOrder(input);
    expect(r.number).toBe("PO-00009");
    expect((calls[4].init.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken AT2");
  });

  it("surfaces Zoho's error message", async () => {
    const { client } = fakeZoho([token(), () => ({ status: 400, body: { code: 1001, message: "Vendor does not exist" } })]);
    await expect(client.createDraftPurchaseOrder(input)).rejects.toThrow(/Vendor does not exist/);
  });

  it("explains a bad refresh token", async () => {
    const { client } = fakeZoho([() => ({ status: 200, body: { error: "invalid_code" } })]);
    await expect(client.accessToken()).rejects.toBeInstanceOf(ZohoError);
  });

  it("finds an existing item by SKU or creates one", async () => {
    const found = fakeZoho([token(), () => ({ status: 200, body: { code: 0, items: [{ item_id: "I7", sku: "SKU001" }] } })]);
    expect(await found.client.ensureItem({ id: "SKU001", name: "Mango", unit: "Units", unitCost: 14, unitPrice: 18 })).toBe("I7");
    const created = fakeZoho([token(), () => ({ status: 200, body: { code: 0, items: [] } }), () => ({ status: 201, body: { code: 0, item: { item_id: "I8" } } })]);
    expect(await created.client.ensureItem({ id: "SKU002", name: "Cookies", unit: "Units", unitCost: 32, unitPrice: 40 })).toBe("I8");
    const body = JSON.parse(String(created.calls[2].init.body));
    expect(body).toMatchObject({ sku: "SKU002", purchase_rate: 32, rate: 40, item_type: "inventory" });
  });
});
