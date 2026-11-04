import type { ReactNode } from "react";
import type { QueueRow } from "@/lib/queries";
import { FLAG_LABEL, type Flag, type ItemMetrics } from "@/lib/rules/engine";
import { num, pct } from "@/lib/format";
import { Badge } from "./ui";

export const FLAG_TONE: Record<Flag, "bad" | "info" | "warn"> = { STOCKOUT_RISK: "bad", HIGH_DEMAND: "info", OVERSTOCK_RISK: "warn" };

/** One SKU = one card: name and flags on top, a plain-language headline, then the few numbers that matter. */
export function SkuCard({ row, aside, children }: { row: QueueRow; aside?: ReactNode; children: ReactNode }) {
  const { item, sku } = row;
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <span id={`row-${item.id}`} className="block scroll-mt-20" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-base font-semibold">{sku.name}</h2>
            <span className="text-sm text-[var(--text-3)]">{sku.id} · {sku.category}</span>
            {item.metrics.perishable && <Badge tone="warn">Perishable</Badge>}
            {(item.flags as Flag[]).map((f) => <Badge key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</Badge>)}
          </header>
          {children}
        </div>
        {aside && <div className="lg:w-72 lg:shrink-0 lg:border-l lg:border-[var(--border)] lg:pl-5">{aside}</div>}
      </div>
    </article>
  );
}

/** "Order 750" / "Pause the next order" plus the one-line why, in words. */
export function Headline({ title, why, tone }: { title: ReactNode; why: ReactNode; tone: "bad" | "warn" | "info" | "mute" }) {
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "info" ? "text-[var(--series-1)]" : "";
  return (
    <div>
      <div className={`num text-xl font-semibold ${color}`}>{title}</div>
      <p className="mt-0.5 text-[var(--text-2)]">{why}</p>
    </div>
  );
}

export function coverWhy(m: ItemMetrics): string {
  if (m.stock == null) return "No stock figure in the latest export.";
  if (m.weeksCover == null) return m.stock > 0 ? `${num(m.stock)} in stock and no recent sales.` : "No stock and no recent sales.";
  const window = `${m.minCoverWeeks}–${m.maxCoverWeeks} weeks`;
  if (m.weeksCover < m.minCoverWeeks) return `Current stock lasts about ${m.weeksCover} weeks. Target is ${window}.`;
  if (m.weeksCover > m.maxCoverWeeks) return `Current stock lasts about ${m.weeksCover} weeks — more than the ${window} target.`;
  return `Current stock lasts about ${m.weeksCover} weeks, inside the ${window} target.`;
}

/**
 * Weeks of cover on a simple scale: the target window is shaded, the marker shows where stock is today.
 * Colour is backed by the words in the headline, never used alone.
 */
export function CoverBar({ m }: { m: ItemMetrics }) {
  if (m.weeksCover == null) return null;
  const scaleMax = Math.max(m.maxCoverWeeks * 1.5, m.weeksCover * 1.1, 1);
  const at = (w: number) => `${Math.min(100, (w / scaleMax) * 100)}%`;
  const below = m.weeksCover < m.minCoverWeeks;
  const above = m.weeksCover > m.maxCoverWeeks;
  const marker = below ? "var(--bad)" : above ? "var(--warn)" : "var(--good)";
  return (
    <div aria-hidden className="max-w-md">
      <div className="relative h-2.5 rounded-full bg-[var(--surface-2)]">
        <div className="absolute inset-y-0 rounded-full bg-[var(--good-bg)] ring-1 ring-[var(--good)]/30"
          style={{ left: at(m.minCoverWeeks), width: `calc(${at(m.maxCoverWeeks)} - ${at(m.minCoverWeeks)})` }} />
        <div className="absolute -top-1 h-4.5 w-1.5 -translate-x-1/2 rounded-full" style={{ left: at(m.weeksCover), background: marker }} />
      </div>
      <div className="relative mt-1 h-4 text-xs text-[var(--text-3)]">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: at((m.minCoverWeeks + m.maxCoverWeeks) / 2) }}>target {m.minCoverWeeks}–{m.maxCoverWeeks} wk</span>
      </div>
    </div>
  );
}

/** Three numbers a planner reads at a glance. */
export function KeyNumbers({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <dl className="grid max-w-xl grid-cols-3 gap-4">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-[var(--text-3)]">{i.label}</dt>
          <dd className="num text-base font-medium">{i.value}</dd>
          {i.hint && <dd className="text-xs text-[var(--text-3)]">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function standardNumbers(m: ItemMetrics) {
  return [
    { label: "In stock", value: num(m.stock) },
    { label: "Expected sales", value: `${num(m.expectedWeekly)}/wk`, hint: m.festival ? `incl. +${Math.round((m.upliftFactor - 1) * 100)}% festival` : undefined },
    { label: "Trend", value: pct(m.changePct), hint: "last 4 wk vs 12 wk" },
  ];
}

/** The AI / template explanation, visually quieter than the headline. */
export function Reason({ text, source, note }: { text: string | null; source: string | null; note?: string | null }) {
  if (!text && !note) return null;
  return (
    <div className="max-w-2xl rounded-lg bg-[var(--surface-2)] px-4 py-3 text-sm leading-relaxed">
      {note && <p className="mb-1.5 font-medium">{note}</p>}
      {text && <p className="text-[var(--text-2)]">{text}</p>}
      <div className="mt-1.5 text-xs text-[var(--text-3)]">{source === "gemini" ? "Explained by Gemini" : "Explained by template"}</div>
    </div>
  );
}

/** Every number behind the flag, one click away instead of always on screen. */
export function NumbersDetail({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer select-none text-[var(--text-2)] hover:text-[var(--text)]">
        <span className="group-open:hidden">Show the numbers</span><span className="hidden group-open:inline">Hide the numbers</span>
      </summary>
      <dl className="mt-2 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-lg border border-[var(--border)] p-3">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-[var(--text-3)]">{k}</dt><dd className="num">{v}</dd></div>
        ))}
      </dl>
    </details>
  );
}

export function metricRows(m: ItemMetrics): [string, ReactNode][] {
  return [
    ["Average, last 4 weeks", `${num(m.avgShort, 1)}/wk`],
    ["Average, last 12 weeks", `${num(m.avgLong, 1)}/wk`],
    ["Last week vs week before", `${num(m.lastWeek)} vs ${num(m.prevWeek)}${m.wowPct != null ? ` (${pct(m.wowPct)})` : ""}`],
    ["Expected next week", `${num(m.expectedWeekly, 1)}/wk${m.festival ? ` (×${m.upliftFactor} festival)` : ""}`],
    ["Weeks of cover", m.weeksCover == null ? "—" : `${m.weeksCover} wk (target ${m.minCoverWeeks}–${m.maxCoverWeeks})`],
    ["Standard order quantity", num(m.standardOrderQty)],
    ["Sales history", `${m.weeksOfHistory} weeks`],
    ...(m.topDistributor ? [["Biggest distributor in the change", `${m.topDistributor.id} (${Math.round(m.topDistributor.sharePct)}%)`] as [string, ReactNode]] : []),
  ];
}

/**
 * Raghav's rules order a fixed quantity (standard, or 1.5× for high demand), which does not always land inside
 * the window: show where stock ends up so a short or oversized order is visible before approval.
 */
export function AfterOrder({ m, qty }: { m: ItemMetrics; qty: number | null }) {
  if (!qty || m.stock == null || m.expectedWeekly <= 0) return null;
  const exact = (m.stock + qty) / m.expectedWeekly;
  const short = exact < m.minCoverWeeks; // compare before rounding: 5.95 weeks is still short of 6
  const over = exact > m.maxCoverWeeks;
  const weeks = short ? Math.floor(exact * 10) / 10 : over ? Math.ceil(exact * 10) / 10 : Math.round(exact * 10) / 10;
  return (
    <p className={`text-sm ${short || over ? "font-medium text-[var(--warn)]" : "text-[var(--text-2)]"}`}>
      {short || over ? "⚠ " : ""}After this order: about {weeks} weeks of stock
      {short ? ` — still below the ${m.minCoverWeeks}-week minimum.` : over ? ` — above the ${m.maxCoverWeeks}-week maximum${m.perishable ? " for a perishable" : ""}.` : `, inside the target.`}
    </p>
  );
}
