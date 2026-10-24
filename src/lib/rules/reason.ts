import type { Evaluation } from "./engine";

const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)}%`;

/**
 * Two plain lines built only from the engine's numbers. Used when Gemini is off (mock mode) or fails,
 * and given to Gemini as the facts it must stay within.
 */
export function templateReason(e: Evaluation): string {
  const m = e.metrics;
  const lines: string[] = [];

  if (e.flags.includes("HIGH_DEMAND") && m.changePct != null)
    lines.push(`Last 4 weeks average ${n(m.avgShort)}/wk, ${pct(m.changePct)} vs the 12-week average of ${n(m.avgLong)}/wk.`);
  else if (m.changePct != null) lines.push(`Selling ${n(m.avgShort)}/wk lately (${pct(m.changePct)} vs the 12-week average).`);

  const festival = m.festival ? ` (with ${Math.round((m.upliftFactor - 1) * 100)}% festival uplift)` : "";
  if (m.stock != null && m.weeksCover != null)
    lines.push(`Stock of ${n(m.stock)} covers ${m.weeksCover} weeks at ${n(m.expectedWeekly)}/wk expected${festival}; target window ${m.minCoverWeeks}–${m.maxCoverWeeks} weeks${m.perishable ? " (perishable)" : ""}.`);
  else if (m.stock != null && m.stock > 0) lines.push(`Stock of ${n(m.stock)} with no recent sales.`);
  else if (m.stock == null) lines.push("No stock figure was loaded for this SKU.");

  // Why it's in the exceptions queue comes first.
  const why: string[] = [];
  if (e.exceptions.includes("WOW_SWING") && m.lastWeek != null && m.prevWeek != null)
    why.push(`Last week ${n(m.lastWeek)} vs ${n(m.prevWeek)} the week before${m.wowPct != null ? ` (${pct(m.wowPct)})` : ""}.`);
  if (e.exceptions.includes("NEW_SKU")) why.push(`Only ${m.weeksOfHistory} weeks of history.`);
  if (e.exceptions.includes("DISTRIBUTOR_CONCENTRATION") && m.topDistributor)
    why.push(`${m.topDistributor.id} drives ${Math.round(m.topDistributor.sharePct)}% of the week-on-week change.`);
  if (e.exceptions.includes("RULES_CONFLICT")) why.push("Demand is rising but stock is already above the window.");

  return [...why, ...lines].slice(0, 2).join(" ");
}

/** What the rules recommend doing with a flagged SKU. */
export function actionLabel(action: string | null) {
  switch (action) {
    case "reorder_now": return "Reorder now";
    case "reorder": return "Reorder";
    case "pause": return "Pause next order";
    case "judgement": return "Your call";
    default: return "—";
  }
}
