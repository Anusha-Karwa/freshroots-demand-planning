import type { ReactNode } from "react";

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "";
  return (
    <div className="rounded border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded border border-stone-200 bg-white p-4">
      {(title || right) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-medium">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE: Record<string, string> = {
  STOCKOUT_RISK: "bg-red-100 text-red-800",
  HIGH_DEMAND: "bg-sky-100 text-sky-800",
  OVERSTOCK_RISK: "bg-amber-100 text-amber-800",
  pending: "bg-stone-100 text-stone-700",
  approved: "bg-emerald-100 text-emerald-800",
  edited: "bg-indigo-100 text-indigo-800",
  rejected: "bg-stone-200 text-stone-700 line-through",
  open: "bg-amber-100 text-amber-800",
  ordered: "bg-emerald-100 text-emerald-800",
  no_action: "bg-stone-200 text-stone-700",
  MOCK: "bg-amber-100 text-amber-800",
};

export function Badge({ children, kind }: { children: ReactNode; kind?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[kind ?? ""] ?? "bg-stone-100 text-stone-700"}`}>
      {children}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: ReactNode }) {
  const cls =
    tone === "error" ? "border-red-200 bg-red-50 text-red-800" : tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-900";
  return <div className={`rounded border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export const inputCls = "rounded border border-stone-300 bg-white px-2 py-1 text-sm";
export const btnCls = "rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50";
export const btnGhostCls = "rounded border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50";
