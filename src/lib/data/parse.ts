import Papa from "papaparse";
import { isoWeekToMonday, mondayOf, toIso } from "@/lib/dates";

/** Reads CSV text into header + rows. Strips a BOM, skips blank lines, trims cells. */
export function readCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data };
}

/** "₹1,23,456.50" → 123456.5, "(120)" → -120, "" → null, "abc" → NaN. */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹,\s]|Rs\.?|INR/gi, "");
  if (s.endsWith("-")) {
    negative = true; // SAP writes negatives as "120-"
    s = s.slice(0, -1);
  }
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

/**
 * Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYYMMDD and ISO weeks ("2026-W27" → its Monday).
 * Indian convention: day before month. Returns null if unreadable.
 */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const week = isoWeekToMonday(s);
  if (week) return week;
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return toIso(date);
}

/** A sales week as its Monday (any date inside the week is accepted). */
export function parseWeek(raw: string | undefined | null): string | null {
  const d = parseDate(raw);
  return d ? mondayOf(d) : null;
}

/** TRUE/Yes/Y/1/High → true; FALSE/No/N/0/Low/Medium → false; anything else → null. */
export function parseBool(raw: string | undefined | null): boolean | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (["true", "yes", "y", "1", "high", "perishable", "active"].includes(s)) return true;
  if (["false", "no", "n", "0", "low", "medium", "med", "non-perishable", "inactive"].includes(s)) return false;
  return null;
}

/** "2026-10", "2026/10", "Oct-2026", "10-2026" → "2026-10". */
export function parseYearMonth(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return +m[1] >= 1 && +m[1] <= 12 ? `${m[2]}-${m[1].padStart(2, "0")}` : null;
  m = /^([a-z]{3})[a-z]*[-/ ](\d{4})$/i.exec(s);
  if (m) {
    const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
    return idx >= 0 ? `${m[2]}-${String(idx + 1).padStart(2, "0")}` : null;
  }
  const d = parseDate(s);
  return d ? d.slice(0, 7) : null;
}

export const cleanId = (raw: string | undefined | null) => (raw ? String(raw).trim().toUpperCase() : "");
