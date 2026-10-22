/**
 * What the loader expects in each of the five seed files (and in a SAP CSV export).
 * Header matching is case/space/punctuation-insensitive and tries every alias.
 * When the real files arrive, add their header names to `aliases` — do not rename fields.
 */

export type FieldType = "string" | "int" | "number" | "bool" | "date";

export interface FieldSpec {
  field: string;
  type: FieldType;
  required: boolean;
  aliases: string[];
  note?: string;
}

export type FileType = "calendar" | "skus" | "distributors" | "inventory" | "weekly_sales";

export const LOAD_ORDER: FileType[] = ["calendar", "skus", "distributors", "weekly_sales", "inventory"];

export const FILE_SPECS: Record<FileType, { description: string; defaultFile: string; fields: FieldSpec[] }> = {
  calendar: {
    description: "Weeks, months, festival periods (Oct, Nov, Mar) and competitor-scheme events",
    defaultFile: "calendar.csv",
    fields: [
      { field: "weekStart", type: "date", required: true, aliases: ["week_start", "week_start_date", "week", "week_date", "start_date", "week_beginning"] },
      { field: "month", type: "int", required: false, aliases: ["month", "month_no", "month_number"], note: "derived from weekStart if absent" },
      { field: "year", type: "int", required: false, aliases: ["year", "fy", "calendar_year"], note: "derived from weekStart if absent" },
      { field: "isFestival", type: "bool", required: false, aliases: ["is_festival", "festival_flag", "festival", "is_festival_week", "festival_period"] },
      { field: "festivalName", type: "string", required: false, aliases: ["festival_name", "festival_event", "event_name", "occasion"] },
      { field: "competitorScheme", type: "string", required: false, aliases: ["competitor_scheme", "competitor_schemes", "competitor_event", "scheme", "competitor_activity"] },
    ],
  },
  skus: {
    description: "The 400 SKUs",
    defaultFile: "skus.csv",
    fields: [
      { field: "skuId", type: "string", required: true, aliases: ["sku_id", "sku", "sku_code", "material", "material_code", "item_code"] },
      { field: "name", type: "string", required: true, aliases: ["name", "sku_name", "description", "material_description", "product_name", "item_name"] },
      { field: "category", type: "string", required: false, aliases: ["category", "product_category", "category_name"] },
      { field: "isPerishable", type: "bool", required: true, aliases: ["is_perishable", "perishable", "perishability", "high_perishability", "perishability_flag", "shelf_life_class"], note: "needed for the 3/4-week rule" },
      { field: "standardOrderQty", type: "int", required: true, aliases: ["standard_order_qty", "standard_order_quantity", "std_order_qty", "moq", "order_qty", "reorder_qty", "eoq"], note: "needed for the 1.5× rule" },
      { field: "unitCost", type: "number", required: false, aliases: ["unit_cost", "cost", "cost_price", "purchase_price", "landed_cost"] },
      { field: "unitPrice", type: "number", required: false, aliases: ["unit_price", "price", "selling_price", "mrp", "ptd", "net_price"] },
      { field: "vendorId", type: "string", required: false, aliases: ["vendor_id", "vendor", "supplier_id", "supplier", "vendor_code"] },
      { field: "launchDate", type: "date", required: false, aliases: ["launch_date", "launched_on", "introduced_on", "start_date"] },
      { field: "active", type: "bool", required: false, aliases: ["active", "is_active", "status"] },
    ],
  },
  distributors: {
    description: "The 1,200 distributors",
    defaultFile: "distributors.csv",
    fields: [
      { field: "distributorId", type: "string", required: true, aliases: ["distributor_id", "distributor", "distributor_code", "customer", "customer_id", "customer_code", "sold_to"] },
      { field: "name", type: "string", required: true, aliases: ["name", "distributor_name", "customer_name"] },
      { field: "district", type: "string", required: false, aliases: ["district", "city", "town"] },
      { field: "region", type: "string", required: false, aliases: ["region", "zone", "territory", "area"] },
      { field: "state", type: "string", required: false, aliases: ["state"] },
      { field: "active", type: "bool", required: false, aliases: ["active", "is_active", "status"] },
    ],
  },
  weekly_sales: {
    description: "Weekly sales by SKU × distributor",
    defaultFile: "weekly_sales.csv",
    fields: [
      { field: "weekStart", type: "date", required: true, aliases: ["week_start", "week_start_date", "week", "week_date", "week_beginning", "posting_week"] },
      { field: "skuId", type: "string", required: true, aliases: ["sku_id", "sku", "sku_code", "material", "material_code", "item_code"] },
      { field: "distributorId", type: "string", required: true, aliases: ["distributor_id", "distributor", "distributor_code", "customer", "customer_id", "customer_code", "sold_to"] },
      { field: "units", type: "number", required: true, aliases: ["units", "units_sold", "qty", "quantity", "sales_qty", "sales_units", "billed_qty"] },
      { field: "value", type: "number", required: false, aliases: ["value", "sales_value", "net_value", "revenue", "amount", "sales_inr"] },
    ],
  },
  inventory: {
    description: "Current stock on hand per SKU",
    defaultFile: "inventory.csv",
    fields: [
      { field: "skuId", type: "string", required: true, aliases: ["sku_id", "sku", "sku_code", "material", "material_code", "item_code"] },
      { field: "stockOnHand", type: "number", required: true, aliases: ["stock_on_hand", "stock", "soh", "on_hand", "qty_on_hand", "closing_stock", "unrestricted_stock", "current_stock"] },
      { field: "snapshotDate", type: "date", required: false, aliases: ["snapshot_date", "as_of", "as_of_date", "stock_date", "date"], note: "defaults to the day after the last sales week" },
      { field: "location", type: "string", required: false, aliases: ["location", "warehouse", "plant", "storage_location", "depot"] },
    ],
  },
};

export const normaliseHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export interface ColumnMapping {
  /** field → original header in the file */
  mapped: Record<string, string>;
  missingRequired: string[];
  missingOptional: string[];
  /** headers in the file that no field claimed */
  unmapped: string[];
}

/** Match a file's headers to fields. `overrides` (field → header) wins, e.g. from the SAP upload mapping step. */
export function mapColumns(type: FileType, headers: string[], overrides: Record<string, string> = {}): ColumnMapping {
  const byNorm = new Map(headers.map((h) => [normaliseHeader(h), h]));
  const mapped: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of FILE_SPECS[type].fields) {
    const override = overrides[f.field];
    const hit = override && headers.includes(override)
      ? override
      : [f.field, ...f.aliases].map((a) => byNorm.get(normaliseHeader(a))).find((h) => h && !used.has(h));
    if (hit) {
      mapped[f.field] = hit;
      used.add(hit);
    }
  }
  const fields = FILE_SPECS[type].fields;
  return {
    mapped,
    missingRequired: fields.filter((f) => f.required && !mapped[f.field]).map((f) => f.field),
    missingOptional: fields.filter((f) => !f.required && !mapped[f.field]).map((f) => f.field),
    unmapped: headers.filter((h) => !used.has(h)),
  };
}
