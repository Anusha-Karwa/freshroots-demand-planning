/** ₹ in lakhs for big numbers ("₹10.3 L"), plain rupees below ₹1 lakh. */
export function inr(x: number | null | undefined, opts: { exact?: boolean } = {}) {
  if (x == null || Number.isNaN(x)) return "—";
  const sign = x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (!opts.exact && a >= 100_000) return `${sign}₹${(a / 100_000).toFixed(a >= 10_000_000 ? 0 : 1)} L`;
  return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
}

export const num = (x: number | null | undefined, dp = 0) =>
  x == null || Number.isNaN(x) ? "—" : x.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: 0 });

export const pct = (x: number | null | undefined, signed = true) =>
  x == null || !Number.isFinite(x) ? "—" : `${signed && x > 0 ? "+" : ""}${Math.round(x)}%`;

export function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateTimeLabel(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function monthLabel(ym: string) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}
