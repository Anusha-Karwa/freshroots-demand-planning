import type { ItemMetrics } from "@/lib/rules/engine";
import { num, pct } from "@/lib/format";

/** The numbers behind a recommendation, so every flag can be checked by hand. */
export function CoverCell({ m }: { m: ItemMetrics }) {
  const below = m.weeksCover != null && m.weeksCover < m.minCoverWeeks;
  const above = m.weeksCover == null ? (m.stock ?? 0) > 0 : m.weeksCover > m.maxCoverWeeks;
  return (
    <div className="num">
      <span className={below ? "font-semibold text-[var(--bad)]" : above ? "font-semibold text-[var(--warn)]" : ""}>
        {m.weeksCover == null ? (m.stock ? "∞" : "—") : `${m.weeksCover} wk`}
      </span>
      <div className="text-xs text-[var(--text-3)]">window {m.minCoverWeeks}–{m.maxCoverWeeks}</div>
    </div>
  );
}

export function TrendCell({ m }: { m: ItemMetrics }) {
  return (
    <div className="num">
      {pct(m.changePct)}
      <div className="text-xs text-[var(--text-3)]">{num(m.avgShort, 1)} vs {num(m.avgLong, 1)}/wk</div>
    </div>
  );
}

export function ExpectedCell({ m }: { m: ItemMetrics }) {
  return (
    <div className="num">
      {num(m.expectedWeekly, 1)}/wk
      {m.festival && <div className="text-xs text-[var(--text-3)]">×{m.upliftFactor} festival</div>}
    </div>
  );
}
