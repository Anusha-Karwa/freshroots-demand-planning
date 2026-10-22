import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { integrationMode } from "@/lib/integrations";

export interface DraftPoLine {
  skuId: string;
  zohoItemId?: string | null;
  name: string;
  quantity: number;
  rate: number;
}

export interface DraftPoInput {
  vendorId: string;
  referenceNumber: string; // our PO id, so procurement can trace it back
  date: string; // YYYY-MM-DD
  notes: string;
  lines: DraftPoLine[];
}

export interface DraftPoResult {
  mode: "live" | "mock";
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  status: string;
}

/** Zoho Inventory PO body. Created as draft: never marked issued or sent. */
export function toZohoPayload(input: DraftPoInput) {
  return {
    vendor_id: input.vendorId,
    reference_number: input.referenceNumber,
    date: input.date,
    notes: input.notes,
    line_items: input.lines.map((l) => ({
      ...(l.zohoItemId ? { item_id: l.zohoItemId } : { name: l.name }),
      description: l.skuId,
      quantity: l.quantity,
      rate: l.rate,
    })),
  };
}

export async function createDraftPurchaseOrder(input: DraftPoInput): Promise<DraftPoResult> {
  if (integrationMode("zoho") === "live") {
    // Live Zoho client (OAuth refresh, rate limits, logging) lands in build phase 5.
    throw new Error("Zoho live mode is not wired up yet (phase 5). Remove ZOHO_* vars to use mock mode.");
  }
  const db = await getDb();
  const payload = toZohoPayload(input);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.mockZohoPurchaseOrders);
  const number = `MOCK-PO-${String(n + 1).padStart(5, "0")}`;
  const [row] = await db
    .insert(schema.mockZohoPurchaseOrders)
    .values({ purchaseOrderNumber: number, payload, status: "draft" })
    .returning({ id: schema.mockZohoPurchaseOrders.id });
  await db.insert(schema.zohoApiLog).values({
    mode: "mock",
    method: "POST",
    path: "/purchaseorders",
    statusCode: 201,
    requestSummary: `vendor=${input.vendorId} lines=${input.lines.length} ref=${input.referenceNumber}`,
    responseSummary: `draft ${number}`,
  });
  return { mode: "mock", purchaseOrderId: `mock-${row.id}`, purchaseOrderNumber: number, status: "draft" };
}
