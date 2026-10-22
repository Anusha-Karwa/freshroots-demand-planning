import type { FieldType } from "./columns";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (error: string): Parsed<never> => ({ ok: false, error });

const TRUE = new Set(["true", "yes", "y", "1", "high", "h", "perishable", "active", "t"]);
const FALSE = new Set(["false", "no", "n", "0", "low", "l", "medium", "med", "non_perishable", "non-perishable", "inactive", "f", ""]);

export function parseBool(raw: string): Parsed<boolean> {
  const v = raw.trim().toLowerCase();
  if (TRUE.has(v)) return ok(true);
  if (FALSE.has(v)) return ok(false);
  return fail(`not a yes/no value: "${raw}"`);
}

export function parseNumber(raw: string): Parsed<number> {
  const v = raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (v === "") return fail("empty number");
  const n = Number(v);
  return Number.isFinite(n) ? ok(n) : fail(`not a number: "${raw}"`);
}

export function parseInt0(raw: string): Parsed<number> {
  const n = parseNumber(raw);
  if (!n.ok) return n;
  return Number.isInteger(n.value) ? n : fail(`not a whole number: "${raw}"`);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Monday of ISO week `week` in ISO year `year`. */
export function isoWeekMonday(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4)); // Jan 4 is always in ISO week 1
  const mondayW1 = Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
  return new Date(mondayW1 + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY (SAP), YYYYMMDD, and ISO weeks
 * (2026-W27, 2026W27 → the Monday of that week). Returns YYYY-MM-DD.
 */
export function parseDate(raw: string): Parsed<string> {
  const v = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = v.match(/^(\d{4})-?W(\d{1,2})$/i))) {
    const [year, week] = [+match[1], +match[2]];
    const monday = isoWeekMonday(year, week);
    // A week belongs to the ISO year its Thursday falls in; that rules out W53 in 52-week years.
    if (week < 1 || week > 53 || addDays(monday, 3).slice(0, 4) !== String(year)) return fail(`invalid ISO week: "${raw}"`);
    return ok(monday);
  }
  if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = v.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else return fail(`unrecognised date: "${raw}"`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return fail(`invalid date: "${raw}"`);
  return ok(`${y}-${pad(m)}-${pad(d)}`);
}

export function parseValue(type: FieldType, raw: string): Parsed<unknown> {
  switch (type) {
    case "string":
      return raw.trim() ? ok(raw.trim()) : fail("empty");
    case "int":
      return parseInt0(raw);
    case "number":
      return parseNumber(raw);
    case "bool":
      return parseBool(raw);
    case "date":
      return parseDate(raw);
  }
}

// ---- date helpers (all UTC, YYYY-MM-DD strings) ----

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Weeks expected between first and last (inclusive, 7-day steps) that are absent from `present`. */
export function missingWeeks(present: Iterable<string>, first?: string, last?: string): string[] {
  const set = new Set(present);
  const sorted = [...set].sort();
  const start = first ?? sorted[0];
  const end = last ?? sorted[sorted.length - 1];
  if (!start || !end) return [];
  const out: string[] = [];
  for (let w = start; w <= end; w = addDays(w, 7)) if (!set.has(w)) out.push(w);
  return out;
}

/** "YYYY-MM" a week belongs to: the month of its Thursday (ISO convention, so a week is never split). */
export const monthOfWeek = (weekStart: string) => addDays(weekStart, 3).slice(0, 7);
