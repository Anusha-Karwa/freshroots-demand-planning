/**
 * The file types we load and the column names we recognise for each field. Header matching ignores case,
 * spaces and punctuation, so "Units Sold", "units_sold" and "UNITS-SOLD" are the same.
 * SAP exports with other headers go through the mapping step on the Data page.
 */

export type FileKind = "skus" | "distributors" | "calendar" | "inventory" | "sales" | "prices" | "planner_history";

export interface FieldSpec {
  field: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const FILE_KINDS: Record<FileKind, { label: string; seedFile?: string; fields: FieldSpec[] }> = {
  sales: {
    label: "Weekly sales (SKU × distributor)",
    seedFile: "weekly_sales.csv",
    fields: [
      { field: "week", label: "Week (Monday date or ISO week)", required: true, aliases: ["week", "week_start", "week_starting", "week_beginning", "posting_week", "iso_week", "calendar_week", "date", "billing_date"] },
      { field: "sku", label: "SKU", required: true, aliases: ["sku_id", "sku", "sku_code", "material", "material_code", "material_number", "item_code", "item_id"] },
      { field: "distributor", label: "Distributor (optional)", required: false, aliases: ["distributor_id", "distributor", "customer", "customer_code", "customer_id", "sold_to", "sold_to_party"] },
      { field: "units", label: "Units sold", required: true, aliases: ["units_sold", "units", "qty", "quantity", "billed_qty", "billed_quantity", "sales_qty", "invoiced_quantity"] },
    ],
  },
  inventory: {
    label: "Stock on hand",
    seedFile: "inventory.csv",
    fields: [
      { field: "sku", label: "SKU", required: true, aliases: ["sku_id", "sku", "material", "material_code", "item_code", "item_id"] },
      { field: "units", label: "Units on hand", required: true, aliases: ["units_on_hand", "stock_on_hand", "soh", "on_hand", "unrestricted_stock", "unrestricted", "closing_stock", "stock", "quantity", "qty"] },
      { field: "asOf", label: "As-of date (optional)", required: false, aliases: ["as_of_date", "as_of", "snapshot_date", "stock_date", "date"] },
      { field: "location", label: "Location (optional)", required: false, aliases: ["location", "plant", "warehouse", "storage_location", "sloc"] },
    ],
  },
  skus: {
    label: "SKU master",
    seedFile: "skus.csv",
    fields: [
      { field: "id", label: "SKU", required: true, aliases: ["sku_id", "sku", "material", "material_code", "item_code"] },
      { field: "name", label: "Name", required: true, aliases: ["sku_name", "name", "description", "material_description", "item_name"] },
      { field: "category", label: "Category", required: false, aliases: ["category", "material_group", "product_category"] },
      { field: "perishable", label: "Perishability (High/Low or Y/N)", required: true, aliases: ["perishability", "perishable", "is_perishable", "high_perishability", "shelf_life_class"] },
      { field: "standardOrderQty", label: "Standard order quantity", required: true, aliases: ["standard_reorder_qty", "standard_order_qty", "standard_qty", "reorder_qty", "order_qty", "moq"] },
      { field: "unit", label: "Unit of measure", required: false, aliases: ["unit_of_measure", "uom", "unit", "base_unit"] },
      { field: "supplier", label: "Supplier", required: false, aliases: ["distributor_id", "supplier_id", "supplier", "vendor_id", "vendor"] },
      { field: "unitCost", label: "Unit cost (₹)", required: false, aliases: ["unit_cost", "cost", "purchase_price", "purchase_rate"] },
      { field: "unitPrice", label: "Unit price (₹)", required: false, aliases: ["unit_price", "price", "selling_price", "mrp", "rate"] },
    ],
  },
  distributors: {
    label: "Distributor master",
    seedFile: "distributors.csv",
    fields: [
      { field: "id", label: "Distributor", required: true, aliases: ["distributor_id", "distributor", "customer", "customer_code", "id"] },
      { field: "name", label: "Name", required: true, aliases: ["distributor_name", "name", "customer_name"] },
      { field: "region", label: "Region", required: false, aliases: ["region", "district", "state", "territory"] },
      { field: "status", label: "Status", required: false, aliases: ["status", "active"] },
    ],
  },
  calendar: {
    label: "Calendar (festival months, competitor schemes)",
    seedFile: "calendar.csv",
    fields: [
      { field: "yearMonth", label: "Year-month (or Year + Month)", required: false, aliases: ["year_month", "yearmonth", "month_start", "period"] },
      { field: "year", label: "Year", required: false, aliases: ["year"] },
      { field: "month", label: "Month", required: false, aliases: ["month", "month_number"] },
      { field: "isFestival", label: "Festival month?", required: false, aliases: ["is_festival_month", "is_festival", "festival", "festival_month"] },
      { field: "festivalName", label: "Festival name", required: false, aliases: ["festival_name", "festivals"] },
      { field: "competitorScheme", label: "Competitor scheme", required: false, aliases: ["competitor_scheme", "competitor_schemes", "scheme"] },
    ],
  },
  prices: {
    label: "Unit cost & price",
    fields: [
      { field: "sku", label: "SKU", required: true, aliases: ["sku_id", "sku", "material"] },
      { field: "unitCost", label: "Unit cost (₹)", required: true, aliases: ["unit_cost", "cost", "purchase_price"] },
      { field: "unitPrice", label: "Unit price (₹)", required: true, aliases: ["unit_price", "price", "selling_price"] },
      { field: "note", label: "Note", required: false, aliases: ["note", "notes"] },
    ],
  },
  planner_history: {
    label: "Raghav's past recommendations (for the backtest)",
    fields: [
      { field: "week", label: "Week", required: true, aliases: ["week", "week_start", "date"] },
      { field: "sku", label: "SKU", required: true, aliases: ["sku_id", "sku", "material"] },
      { field: "flag", label: "Flag (HIGH_DEMAND / STOCKOUT_RISK / OVERSTOCK_RISK / NONE)", required: true, aliases: ["flag", "recommendation", "decision"] },
    ],
  },
};

export const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export type ColumnMap = Record<string, string | null>; // field → header in the file

/** Guesses which header holds each field. */
export function autoMap(kind: FileKind, headers: string[]): ColumnMap {
  const byNorm = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const used = new Set<string>();
  const map: ColumnMap = {};
  for (const f of FILE_KINDS[kind].fields) {
    const hit = f.aliases.map((a) => byNorm.get(a)).find((h) => h && !used.has(h)) ?? null;
    if (hit) used.add(hit);
    map[f.field] = hit;
  }
  return map;
}

export function missingRequired(kind: FileKind, map: ColumnMap) {
  const missing = FILE_KINDS[kind].fields.filter((f) => f.required && !map[f.field]).map((f) => f.label);
  if (kind === "calendar" && !map.yearMonth && !(map.year && map.month)) missing.push("Year-month (or Year + Month)");
  return missing;
}
