import { inr, monthLabel } from "@/lib/format";

export interface LossMonth { yearMonth: string; stockout: number; overstock: number }

/**
 * Monthly ₹ losses (stockout lost sales + overstock write-offs, stacked) against the baseline range and the
 * kill-switch limit. Server-rendered SVG: each month column has a hover tooltip, and a table view follows.
 */
export function LossChart({ months, baselineLow, baselineHigh, limit }: { months: LossMonth[]; baselineLow: number; baselineHigh: number; limit: number }) {
  const W = 640, H = 240, padL = 52, padR = 12, padT = 12, padB = 28;
  const max = Math.max(limit, baselineHigh, ...months.map((m) => m.stockout + m.overstock)) * 1.15;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const colW = (W - padL - padR) / Math.max(months.length, 1);
  const barW = Math.min(36, colW * 0.6);
  const ticks = [0, max / 3, (2 * max) / 3].map((t) => Math.round(t / 100_000) * 100_000);

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-[var(--text-2)]">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--series-1)]" />Stockout lost sales</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--series-2)]" />Overstock write-offs</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 bg-[var(--mute-bg)] outline outline-1 outline-[var(--border)]" />Baseline {inr(baselineLow)}–{inr(baselineHigh)}/month</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-[var(--text-2)]" />Kill limit {inr(limit)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly losses vs baseline">
        <rect x={padL} y={y(baselineHigh)} width={W - padL - padR} height={y(baselineLow) - y(baselineHigh)} fill="var(--mute-bg)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-3)">{inr(t)}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(limit)} y2={y(limit)} stroke="var(--text-2)" strokeWidth={1.5} strokeDasharray="5 4" />
        {months.map((m, i) => {
          const cx = padL + colW * i + colW / 2;
          const total = m.stockout + m.overstock;
          const yS = y(m.stockout);
          const yT = y(total);
          return (
            <g key={m.yearMonth}>
              <title>{`${monthLabel(m.yearMonth)}: total ${inr(total)} — stockouts ${inr(m.stockout)}, overstock ${inr(m.overstock)}${total > limit ? " (above kill limit)" : ""}`}</title>
              <rect x={padL + colW * i} y={padT} width={colW} height={H - padT - padB} fill="transparent" />
              {m.stockout > 0 && <rect x={cx - barW / 2} y={yS} width={barW} height={y(0) - yS} fill="var(--series-1)" />}
              {m.overstock > 0 && (
                <path
                  d={`M${cx - barW / 2},${yS - 2} V${yT + 4} Q${cx - barW / 2},${yT} ${cx - barW / 2 + 4},${yT} H${cx + barW / 2 - 4} Q${cx + barW / 2},${yT} ${cx + barW / 2},${yT + 4} V${yS - 2} Z`}
                  fill="var(--series-2)"
                />
              )}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--text-2)">{monthLabel(m.yearMonth)}</text>
              {i === months.length - 1 && <text x={cx} y={yT - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">{inr(total)}</text>}
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-xs text-[var(--text-2)]">
        <summary className="cursor-pointer">Table view</summary>
        <table className="data mt-2">
          <thead><tr><th>Month</th><th className="r">Stockouts</th><th className="r">Overstock</th><th className="r">Total</th></tr></thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.yearMonth}><td>{monthLabel(m.yearMonth)}</td><td className="r num">{inr(m.stockout)}</td><td className="r num">{inr(m.overstock)}</td><td className="r num">{inr(m.stockout + m.overstock)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
