// All dates are ISO "YYYY-MM-DD" strings handled in UTC, so server time zones never shift a week.
// Business days are in India time (IST, UTC+05:30).

const DAY = 86_400_000;

export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY));
export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY);

/** Monday of the week containing the date. */
export function mondayOf(iso: string) {
  const dow = (toDate(iso).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(iso, -dow);
}

/** "2026-W27" → Monday of ISO week 27 of 2026. */
export function isoWeekToMonday(label: string): string | null {
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(label.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = `${year}-01-04`; // always in ISO week 1
  return addDays(mondayOf(jan4), (week - 1) * 7);
}

export function isoWeekLabel(monday: string) {
  const thursday = toDate(addDays(monday, 3));
  const year = thursday.getUTCFullYear();
  const week1Monday = mondayOf(`${year}-01-04`);
  const week = Math.floor(daysBetween(week1Monday, monday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** A week belongs to the month its Thursday falls in (ISO convention: a week is never split). */
export const yearMonthOfWeek = (monday: string) => addDays(monday, 3).slice(0, 7);

/** Today's date in India. */
export function todayIst(now = new Date()) {
  return toIso(new Date(now.getTime() + 330 * 60_000));
}

export const monthOf = (iso: string) => Number(iso.slice(5, 7));
