import { rupees } from "@/lib/ui/format";

/**
 * Monthly ₹ losses (stockout lost sales + overstock write-offs, stacked) against the baseline band and the
 * kill-switch limit. Plain SVG; hover a bar for its numbers; the table on the Tracker page is the text view.
 */
export interface LossPoint {
  month: string; // YYYY-MM
  stockout: number;
  overstock: number;
}

const C = { stockout: "#2a78d6", overstock: "#eb6834", band: "#e7e5e0", limit: "#57534e", grid: "#ece9e4", text: "#57534e" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export function LossChart({ data, band, limit }: { data: LossPoint[]; band: { low: number; high: number }; limit: number }) {
  if (!data.length)
    return <p className="text-sm text-stone-500">No monthly losses entered yet — add them on the Tracker page.</p>;
  const W = 640, H = 240, L = 56, R = 12, T = 12, B = 28;
  const max = Math.max(limit, band.high, ...data.map((d) => d.stockout + d.overstock)) * 1.1;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const step = (W - L - R) / Math.max(data.length, 6);
  const bw = Math.min(40, step * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((max * f) / 100_000) * 100_000);
  const bar = (x: number, top: number, h: number, color: string, roundTop: boolean) =>
    h <= 0 ? null : roundTop ? (
      <path d={`M${x},${top + h} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${top + h} Z`} fill={color} />
    ) : (
      <rect x={x} y={top} width={bw} height={h} fill={color} />
    );

  return (
    <figure>
      <div className="mb-1 flex flex-wrap gap-4 text-xs text-stone-600">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.stockout }} />Stockout lost sales</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.overstock }} />Overstock write-offs</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4" style={{ background: C.band }} />Baseline {rupees(band.low)}–{rupees(band.high)}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: C.limit }} />Kill limit {rupees(limit)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly losses versus baseline">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.grid} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={C.text}>{t ? `₹${t / 100_000} L` : "0"}</text>
          </g>
        ))}
        <rect x={L} width={W - L - R} y={y(band.high)} height={y(band.low) - y(band.high)} fill={C.band} opacity={0.8} />
        {data.map((d, i) => {
          const x = L + step * i + (step - bw) / 2;
          const total = d.stockout + d.overstock;
          const sTop = y(d.stockout);
          const oTop = y(total);
          const gap = d.stockout > 0 && d.overstock > 0 ? 2 : 0;
          return (
            <g key={d.month}>
              <title>{`${label(d.month)}: ${rupees(total)} (stockout ${rupees(d.stockout)}, overstock ${rupees(d.overstock)})`}</title>
              {bar(x, sTop, y(0) - sTop, C.stockout, d.overstock <= 0)}
              {bar(x, oTop, sTop - oTop - gap, C.overstock, true)}
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="10" fill={C.text}>{label(d.month)}</text>
              <rect x={x - 4} y={T} width={bw + 8} height={H - T - B} fill="transparent" />
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(limit)} y2={y(limit)} stroke={C.limit} strokeWidth={1.5} strokeDasharray="5 4" />
      </svg>
    </figure>
  );
}
