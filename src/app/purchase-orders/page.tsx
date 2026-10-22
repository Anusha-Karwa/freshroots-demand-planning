import { requireUser } from "@/lib/auth";
import { integrationMode } from "@/lib/integrations";
import { groupByVendor, purchaseOrders, readyLines, vendorMap, zohoLog } from "@/lib/purchase-orders";
import { getDb, schema } from "@/lib/db";
import { Badge, Card, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui";
import { num, rupees } from "@/lib/ui/format";
import { confirmMockPO, createPOs, retryPO, saveVendorMapAction, syncPOs } from "../actions";

export const dynamic = "force-dynamic";

type PoLine = { skuId: string; name: string; quantity: number; rate: number; source: string };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const planner = user.role === "planner";
  const mode = integrationMode("zoho");
  const db = await getDb();
  const [ready, map, pos, log, suppliers] = await Promise.all([
    readyLines(), vendorMap(), purchaseOrders(), zohoLog(),
    db.selectDistinct({ v: schema.skus.vendorId }).from(schema.skus),
  ]);
  const groups = groupByVendor(ready.lines, map, process.env.ZOHO_DEFAULT_VENDOR_ID);
  const supplierIds = suppliers.map((s) => s.v).filter((v): v is string => Boolean(v)).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Purchase orders</h1>
        <Badge kind={mode === "mock" ? "MOCK" : "approved"}>{mode === "mock" ? "Zoho: MOCK" : "Zoho: live"}</Badge>
      </div>
      <p className="text-sm text-stone-600">
        Raghav’s approved lines become one <b>draft</b> PO per supplier in Zoho Inventory. Procurement confirms the draft in Zoho;
        nothing is ordered from here. {mode === "mock" && "Zoho keys aren’t set, so POs are stored locally and marked MOCK."}
      </p>
      {sp.ok && <Notice tone="ok">{sp.ok}</Notice>}
      {sp.error && <Notice tone="error">{sp.error}</Notice>}

      <Card
        title={`Ready for a draft PO${ready.runId ? ` (run #${ready.runId}, data as of ${ready.dataAsOf})` : ""}`}
        right={planner && groups.length > 0 && (
          <form action={createPOs}><button className={btnCls}>Create {groups.length} draft PO{groups.length === 1 ? "" : "s"}</button></form>
        )}
      >
        {groups.length === 0 ? (
          <p className="text-sm text-stone-500">No approved lines waiting. Approve lines in the review queue (or order an exception) first.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.supplierId} className="text-sm">
                <p className="font-medium">
                  Supplier {g.supplierId} → Zoho vendor {g.zohoVendorId}{" "}
                  <span className="font-normal text-stone-500">· {rupees(g.totalValue)}{g.placeholderPrices && " (placeholder costs)"}</span>
                </p>
                <ul className="ml-4 list-disc text-stone-700">
                  {g.lines.map((l) => (
                    <li key={`${l.source}-${l.id}`}>
                      {l.skuId} {l.name} — {num(l.quantity)} units{l.unitCost != null && ` × ${rupees(l.unitCost)}`}
                      {l.source === "exception" && <span className="text-xs text-amber-700"> (exception, Raghav’s qty)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Draft POs" right={planner && mode === "live" && <form action={syncPOs}><button className={btnGhostCls}>Sync status from Zoho</button></form>}>
        {pos.length === 0 ? (
          <p className="text-sm text-stone-500">None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 pr-3">PO</th><th className="py-1 pr-3">Zoho number</th><th className="py-1 pr-3">Supplier</th>
                  <th className="py-1 pr-3">Lines</th><th className="py-1 pr-3 text-right">Value</th><th className="py-1 pr-3">Status</th><th className="py-1">Data as of</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100 align-top">
                    <td className="py-1 pr-3">FR-PO-{p.id}<div className="text-xs text-stone-400">{p.createdBy}</div></td>
                    <td className="py-1 pr-3">{p.zohoPurchaseOrderNumber ?? "—"} {p.mode === "mock" && <Badge kind="MOCK">MOCK</Badge>}</td>
                    <td className="py-1 pr-3">{p.vendorId}</td>
                    <td className="py-1 pr-3 text-xs">{(p.lines as PoLine[]).map((l) => `${l.skuId} × ${num(l.quantity)}`).join(", ")}</td>
                    <td className="py-1 pr-3 text-right">{rupees(p.totalValue ?? 0)}</td>
                    <td className="py-1 pr-3">
                      <Badge kind={p.status === "failed" ? "STOCKOUT_RISK" : p.status === "draft" ? "pending" : "approved"}>{p.status}</Badge>
                      {p.error && <div className="max-w-xs text-xs text-red-700">{p.error}</div>}
                      {planner && p.status === "failed" && (
                        <form action={retryPO} className="mt-1"><input type="hidden" name="id" value={p.id} /><button className={btnGhostCls}>Retry</button></form>
                      )}
                      {planner && p.mode === "mock" && p.status === "draft" && (
                        <form action={confirmMockPO} className="mt-1"><input type="hidden" name="id" value={p.id} /><button className="text-xs underline">simulate procurement confirming</button></form>
                      )}
                    </td>
                    <td className="py-1">{p.dataAsOf ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Supplier → Zoho vendor">
          <p className="mb-2 text-xs text-stone-500">
            Suppliers come from the SKU file’s Distributor_ID. Enter each one’s Zoho vendor id (Purchases → Vendors → the number in the
            URL). Blank = ZOHO_DEFAULT_VENDOR_ID{process.env.ZOHO_DEFAULT_VENDOR_ID ? ` (${process.env.ZOHO_DEFAULT_VENDOR_ID})` : " (not set)"}.
          </p>
          <form action={saveVendorMapAction} className="space-y-1">
            <fieldset disabled={!planner} className="space-y-1">
              {supplierIds.map((id) => (
                <label key={id} className="flex items-center justify-between gap-2 text-sm">
                  {id}
                  <input name={`vendor:${id}`} defaultValue={map[id] ?? ""} placeholder="Zoho vendor id" className={`${inputCls} w-48`} />
                </label>
              ))}
              {planner && <button className={`${btnGhostCls} mt-2`}>Save mapping</button>}
            </fieldset>
          </form>
        </Card>
        <Card title="Zoho API log">
          {log.length === 0 ? (
            <p className="text-sm text-stone-500">No calls yet.</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {log.map((l) => (
                <li key={l.id}>
                  {l.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })} · {l.mode} · {l.method} {l.path} → {l.statusCode}{" "}
                  <span className="text-stone-500">{l.requestSummary} {l.responseSummary && `· ${l.responseSummary}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
