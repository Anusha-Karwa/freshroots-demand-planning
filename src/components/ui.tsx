import Link from "next/link";
import type { ReactNode } from "react";
import type { Light } from "@/lib/killswitch";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[var(--text-2)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    // min-w-0: inside a grid, a card must not grow to fit its widest table or input row (phones scrolled sideways).
    <section className={`min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-[var(--good)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "bad" ? "text-[var(--bad)]" : "";
  return (
    <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-sm text-[var(--text-3)]">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-sm text-[var(--text-2)]">{sub}</div>}
    </div>
  );
}

const TONES = {
  good: "bg-[var(--good-bg)] text-[var(--good)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn)]",
  bad: "bg-[var(--bad-bg)] text-[var(--bad)]",
  info: "bg-[var(--info-bg)] text-[var(--series-1)]",
  mute: "bg-[var(--mute-bg)] text-[var(--text-2)]",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "mute", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

const LIGHT: Record<Light, { tone: Tone; icon: string; label: string }> = {
  green: { tone: "good", icon: "●", label: "Green" },
  amber: { tone: "warn", icon: "▲", label: "Amber" },
  red: { tone: "bad", icon: "■", label: "Red" },
  grey: { tone: "mute", icon: "○", label: "Not enough data" },
};

/** Status light: colour + icon + word, never colour alone. */
export function StatusLight({ status, label }: { status: Light; label?: string }) {
  const l = LIGHT[status];
  return <Badge tone={l.tone}><span aria-hidden>{l.icon}</span> {label ?? l.label}</Badge>;
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    // Sticky, so the result stays visible when the page scrolls back to the row that was decided.
    <div role="status" className={`sticky top-2 z-20 mb-4 rounded-md px-3 py-2 shadow-sm ${err ? TONES.bad : TONES.good}`}>
      {err ?? msg}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-2)]">{children}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v = variant === "primary"
    ? "bg-[var(--accent)] text-[var(--accent-ink)] border-transparent hover:opacity-90"
    : variant === "danger"
      ? "bg-[var(--surface)] text-[var(--bad)] border-[var(--border)] hover:bg-[var(--bad-bg)]"
      : "bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-2)]";
  return <button {...props} className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50 ${v} ${props.className ?? ""}`}>{children}</button>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} prefetch={false} className="text-[var(--series-1)] underline-offset-2 hover:underline">{children}</Link>;
}

export function MockTag() {
  return <Badge tone="warn" title="Keys not set: this is a stand-in, nothing was sent">MOCK</Badge>;
}
