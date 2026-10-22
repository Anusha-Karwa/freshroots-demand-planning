import type { Evaluation, ExceptionType, Flag } from "./engine";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const n1 = (x: number) => x.toFixed(1);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x)}%`;

export const FLAG_LABEL: Record<Flag, string> = {
  HIGH_DEMAND: "High demand",
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
};

export const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  NEW_SKU: "New SKU (short history)",
  DISTRIBUTOR_CONCENTRATION: "One distributor drives the change",
  WOW_SWING: "Large week-on-week swing",
  CONFLICTING_FLAGS: "Rules conflict",
  AI_UNUSUAL: "Looks unusual (AI)",
};

/** Two-line, numbers-only explanation. Used as-is in mock mode and as Gemini's fallback. */
export function templateReason(e: Extract<Evaluation, { kind: "flag" }>, planningMonth: number): string {
  const m = e.metrics;
  const demand =
    m.pct4v12 === null
      ? `No sales in the last ${m.weeksOfHistory} weeks.`
      : `Last 4 weeks average ${n0(m.avg4)}/week, ${pct(m.pct4v12)} vs the 12-week average of ${n0(m.avg12)}.`;
  const festival = m.festival ? ` ${MONTHS[planningMonth - 1]} festival demand (${n0(m.expectedWeekly)}/week incl. +${Math.round((m.uplift - 1) * 100)}%)` : ` demand (${n0(m.expectedWeekly)}/week)`;
  const window = `${m.coverWindow.minWeeks}–${m.coverWindow.maxWeeks} week${m.coverWindow.perishable ? " perishable" : ""} window`;
  const cover =
    m.weeksOfCover === null
      ? `Stock of ${n0(m.stockOnHand)} has no recent demand to cover.`
      : `Stock of ${n0(m.stockOnHand)} covers ${n1(m.weeksOfCover)} weeks of${festival} against a ${window}.`;
  return `${demand}\n${cover}`;
}

export function templateExceptionNote(e: Extract<Evaluation, { kind: "exception" }>): string {
  const m = e.metrics;
  const parts = e.types.map((t) => {
    switch (t) {
      case "NEW_SKU":
        return `Only ${m.weeksOfHistory} weeks of history, too short for the 12-week average.`;
      case "WOW_SWING":
        return m.prevWeekUnits === 0
          ? `Sales restarted from zero last week (${n0(m.lastWeekUnits)} units).`
          : `Sales moved ${pct(m.wowPct ?? 0)} week on week (${n0(m.prevWeekUnits ?? 0)} → ${n0(m.lastWeekUnits)}); the rules can't tell a one-off from a trend.`;
      case "DISTRIBUTOR_CONCENTRATION":
        return `Distributor ${m.topDistributor?.id} drove ${Math.round(m.topDistributor?.sharePct ?? 0)}% of last week's change.`;
      case "CONFLICTING_FLAGS":
        return `Demand is up ${pct(m.pct4v12 ?? 0)} but stock already covers ${n1(m.weeksOfCover ?? 0)} weeks.`;
      case "AI_UNUSUAL":
        return "Gemini thought this flag looks unusual.";
    }
  });
  const flags = e.ruleFlags.length ? ` Rules alone would flag: ${e.ruleFlags.map((f) => FLAG_LABEL[f]).join(", ")}.` : "";
  return parts.join(" ") + flags;
}
