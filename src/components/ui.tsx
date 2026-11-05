import Link from "next/link";
import type { ReactNode } from "react";
import type { Light } from "@/lib/killswitch";

/** A word on a skewed green bar. */
export function Hl({ children }: { children: ReactNode }) {
  return <span className="hl">{children}</span>;
}

/** Display headline: Anton, uppercase, the last word on a green bar. */
export function Headline({ text, className = "" }: { text: string; className?: string }) {
  const words = text.trim().split(/\s+/);
  const last = words.pop();
  return <h1 className={`display ${className}`}>{words.join(" ")}{words.length ? " " : ""}<Hl>{last}</Hl></h1>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <Headline text={title} className="text-5xl md:text-6xl" />
        {subtitle && <p className="mt-3 max-w-2xl text-[var(--text-2)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    // min-w-0: inside a grid, a card must not grow to fit its widest table or input row (phones scrolled sideways).
    <section className={`min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 ${className}`}>
      {(title || right) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="display text-2xl">{title}</h2>}
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
    <div className="lift min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-3)]">{label}</div>
      <div className={`display num mt-3 text-4xl ${color}`}>{value}</div>
      {sub && <div className="mt-2 text-sm text-[var(--text-2)]">{sub}</div>}
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
  return <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONES[tone]}`}>{children}</span>;
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
    <div role="status" className={`sticky top-3 z-20 mb-6 rounded-xl px-4 py-3 font-medium shadow-lg ${err ? TONES.bad : "bg-[var(--ink)] text-white"}`}>
      {!err && <span className="mr-2 inline-block size-2 rounded-full bg-[var(--green)] align-middle" aria-hidden />}
      {err ?? msg}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid-bg rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--text-2)]">{children}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "dark" }) {
  const v = variant === "primary"
    ? "bg-[var(--accent)] text-[var(--accent-ink)] border-transparent hover:brightness-95"
    : variant === "dark"
      ? "bg-[var(--ink)] text-white border-transparent hover:opacity-90"
      : variant === "danger"
        ? "bg-[var(--surface)] text-[var(--bad)] border-[var(--border)] hover:bg-[var(--bad-bg)]"
        : "bg-[var(--surface)] text-[var(--text)] border-[rgb(23_30_25/0.2)] hover:bg-[var(--surface-2)]";
  return <button {...props} className={`rounded-full border px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${v} ${props.className ?? ""}`}>{children}</button>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} prefetch={false} className="font-medium underline decoration-[var(--green)] decoration-2 underline-offset-4 hover:bg-[var(--green)]/30">{children}</Link>;
}

export function MockTag() {
  return <Badge tone="warn" title="Keys not set: this is a stand-in, nothing was sent">MOCK</Badge>;
}
