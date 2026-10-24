import { desc } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { dateTimeLabel, inr, num } from "@/lib/format";
import { mode } from "@/lib/integrations";
import { pageDb, param, type SearchParams } from "@/lib/page";
import { groupBySupplier, linesToOrder, listPurchaseOrders } from "@/lib/purchase-orders";
import { getVendorMap } from "@/lib/settings";
import { Badge, Button, Card, Empty, Flash, MockTag, PageHeader } from "@/components/ui";
import { confirmMockPurchaseOrder, createPurchaseOrdersAction, retryPurchaseOrderAction, saveVendorMap } from "../../actions";

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "info" | "mute"> = { draft: "warn", issued: "good", open: "good", billed: "good", closed: "mute", failed: "bad", cancelled: "mute" };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const db = await pageDb();
  const zohoMode = mode("zoho");
  const [lines, vendorMap, pos, suppliers, apiLog] = await Promise.all([
    linesToOrder(db), getVendorMap(db), listPurchaseOrders(db),
    db.selectDistinct({ id: schema.skus.supplierId }).from(schema.skus),
    db.select().from(schema.zohoApiLog).orderBy(desc(schema.zohoApiLog.id)).limit(15),
  ]);
  const defaultVendor = process.env.ZOHO_DEFAULT_VENDOR_ID?.trim();
  const groups = groupBySupplier(lines, vendorMap, defaultVendor, zohoMode === "live");
  const planner = session.role === "planner";

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Approved lines from the latest run become one draft purchase order per supplier in Zoho Inventory. Procurement confirms (issues) them inside Zoho; nothing is sent to a supplier from here."
        actions={zohoMode === "mock" ? <MockTag /> : <Badge tone="good">Zoho live</Badge>}
      />
      <Flash msg={param(sp.msg)} err={param(sp.err)} />

      <Card title={`Ready to order (${lines.length} line${lines.length === 1 ? "" : "s"})`} className="mb-4"
        right={planner && lines.length > 0 && <form action={createPurchaseOrdersAction}><Button>Create {groups.length} draft PO{groups.length === 1 ? "" : "s"}{zohoMode === "mock" ? " (mock)" : " in Zoho"}</Button></form>}>
        {groups.length === 0 ? <Empty>No approved lines waiting. Approve lines in the Review queue or set quantities on Exceptions.</Empty> : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.supplierId}>
                <div className="mb-1 text-sm font-medium">
                  Supplier {g.supplierId} → Zoho vendor {g.vendorId ?? <Badge tone="bad">not mapped</Badge>}
                </div>
                <table className="data">
                  <thead><tr><th>SKU</th><th className="r">Qty</th><th className="r">Rate (cost)</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.itemId}>
                        <td>{l.skuId} · {l.name}</td>
                        <td className="r num">{num(l.qty)} {l.unit}</td>
                        <td className="r num">{inr(l.rate, { exact: true })}{l.placeholderPrice && <span title="Placeholder cost — replace with real prices"> *</span>}</td>
                        <td className="r num">{inr(l.qty * l.rate, { exact: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {lines.some((l) => l.placeholderPrice) && <p className="text-xs text-[var(--text-3)]">* Placeholder unit cost (no real prices loaded yet); the PO notes say so.</p>}
          </div>
        )}
      </Card>

      <Card title="Draft purchase orders" className="mb-4">
        {pos.length === 0 ? <Empty>No purchase orders yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>PO</th><th>Created</th><th>Supplier → vendor</th><th>Status</th><th className="r">Total</th><th className="r">Data age</th><th>Lines</th>{planner && <th></th>}</tr></thead>
              <tbody>
                {pos.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <div className="font-medium">{po.zohoPoNumber ?? `#${po.id}`}</div>
                      <div className="mt-0.5">{po.mode === "mock" ? <MockTag /> : <Badge tone="info">Zoho</Badge>}</div>
                    </td>
                    <td className="text-xs">{dateTimeLabel(po.createdAt)}<div className="text-[var(--text-3)]">{po.createdBy} · run #{po.runId}</div></td>
                    <td className="text-xs">{po.supplierId} → {po.zohoVendorId ?? "—"}</td>
                    <td>
                      <Badge tone={STATUS_TONE[po.status] ?? "mute"}>{po.status}</Badge>
                      {po.error && <div className="mt-1 max-w-xs text-xs text-[var(--bad)]">{po.error}</div>}
                    </td>
                    <td className="r num">{inr(po.total)}</td>
                    <td className="r num">{po.dataAgeDays == null ? "—" : `${po.dataAgeDays} d`}</td>
                    <td className="text-xs">{po.lines.map((l) => <div key={l.line.id}>{l.line.skuId} × {num(l.line.qty)}</div>)}</td>
                    {planner && (
                      <td>
                        {po.status === "failed" && (
                          <form action={retryPurchaseOrderAction}><input type="hidden" name="poId" value={po.id} /><Button variant="secondary">Retry</Button></form>
                        )}
                        {po.mode === "mock" && po.status === "draft" && (
                          <form action={confirmMockPurchaseOrder}>
                            <input type="hidden" name="poId" value={po.id} />
                            <Button variant="secondary" title="Stands in for procurement issuing the draft in Zoho">Simulate procurement confirm</Button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Supplier → Zoho vendor">
          <p className="mb-3 text-xs text-[var(--text-2)]">
            Each SKU’s supplier (the SKU file’s Distributor_ID) maps to a vendor in Zoho (Purchases → Vendors → the id in the URL).
            Unmapped suppliers use ZOHO_DEFAULT_VENDOR_ID{defaultVendor ? ` (${defaultVendor})` : " (not set)"}.
          </p>
          <form action={saveVendorMap} className="space-y-2">
            {suppliers.filter((s) => s.id).map((s) => (
              <label key={s.id} className="flex items-center gap-3">
                <span className="w-24 font-medium">{s.id}</span>
                <input name={`vendor:${s.id}`} defaultValue={vendorMap[s.id!] ?? ""} placeholder={defaultVendor ?? "Zoho vendor id"} disabled={!planner} className="flex-1" />
              </label>
            ))}
            {planner && <Button variant="secondary">Save mapping</Button>}
          </form>
        </Card>
        <Card title="Zoho API log">
          {apiLog.length === 0 ? <Empty>{zohoMode === "mock" ? "Mock mode: no calls to Zoho." : "No calls yet."}</Empty> : (
            <table className="data text-xs">
              <tbody>
                {apiLog.map((l) => (
                  <tr key={l.id}><td className="whitespace-nowrap">{dateTimeLabel(l.createdAt)}</td><td>{l.method} {l.path}</td><td className="num">{l.status}</td><td>{l.summary}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
