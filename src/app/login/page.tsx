import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { authEnabled } from "@/lib/auth/session";
import { param, type SearchParams } from "@/lib/page";
import { login } from "../actions";

/**
 * The front door: what the system does (for Deepa, the CEO, or a reviewer opening the link) and the sign-in form.
 * Every claim on this page is a fact from the case or the build; the quotes are the case's own words.
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  await connection(); // passwords are read at request time, not baked in at build
  if (!authEnabled()) redirect("/");
  const sp = await searchParams;
  const err = param(sp.err);
  const next = param(sp.next) ?? "/";

  return (
    <div className="bg-white text-[#171e19] [color-scheme:light]">
      <Header />
      <Hero err={err} next={next} />
      <Stack />
      <OldVsNew />
      <Bento />
      <HowItWorks />
      <Quotes />
      <FinalCta />
      <footer className="bg-[#171e19] px-6 py-10 text-sm text-[#b7c6c2]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <span className="display text-2xl text-white">Freshroots<span className="text-[#8ff0a4]">.</span></span>
          <span>MESA AI-Native Track · Case 01 · Demand planning</span>
        </div>
      </footer>
    </div>
  );
}

const ink = "#171e19";

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-20 border-b border-[#171e19]/10 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-6 px-6">
        <a href="#top" className="display text-3xl">Freshroots<span className="text-[#1f9d55]">.</span></a>
        <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
          <a href="#how" className="hover:underline">How it works</a>
          <a href="#features" className="hover:underline">Features</a>
          <a href="#case" className="hover:underline">The case</a>
        </nav>
        <div className="flex items-center gap-5">
          <a href="#signin" className="hidden text-sm font-medium sm:inline">Login</a>
          <a href="#signin" className="rounded-full bg-[#171e19] px-6 py-2.5 text-sm font-bold text-white transition hover:opacity-90">Open dashboard</a>
        </div>
      </div>
    </header>
  );
}

function Hero({ err, next }: { err?: string; next: string }) {
  return (
    <section id="top" className="grid-bg relative overflow-hidden px-6 pt-36 pb-20 md:pt-44">
      <div className="mx-auto max-w-6xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#171e19]/15 bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-widest">
          <span className="size-2 animate-pulse rounded-full bg-[#1f9d55]" aria-hidden /> Live · next run Mon &amp; Thu, 6:00 am
        </span>
        <h1 className="display mx-auto mt-8 max-w-5xl text-6xl sm:text-7xl md:text-8xl lg:text-9xl">
          Plan demand twice a <span className="hl">week</span>
        </h1>
        <p className="mx-auto mt-8 max-w-xl text-lg text-[#171e19]/70">
          Fresh SAP data every Monday and Thursday. Raghav’s rules flag the risks, Gemini explains each one in two lines,
          Raghav makes the call, and approved lines land in Zoho as draft purchase orders.
        </p>
        <form id="signin" action={login} className="mx-auto mt-10 flex max-w-3xl scroll-mt-28 flex-col gap-3 sm:flex-row">
          <input type="hidden" name="next" value={next} />
          <input name="name" required autoComplete="name" placeholder="Your name (goes in the decision log)" aria-label="Your name"
            className="flex-1 rounded-lg border-[#171e19]/20 bg-white px-6 py-4 text-base text-[#171e19]" />
          <input name="password" type="password" required autoComplete="current-password" placeholder="Password" aria-label="Password"
            className="flex-1 rounded-lg border-[#171e19]/20 bg-white px-6 py-4 text-base text-[#171e19] sm:max-w-56" />
          <button className="display rounded-lg bg-[#8ff0a4] px-8 py-4 text-xl text-[#171e19] transition hover:-translate-y-0.5 hover:shadow-lg">Sign in</button>
        </form>
        {err && <div role="alert" className="mx-auto mt-4 max-w-3xl rounded-lg bg-[#ffe5e2] px-4 py-2 text-left font-medium text-[#c0261a]">{err}</div>}
        <p className="mt-4 text-sm text-[#171e19]/55">Planner password to decide · viewer password for read-only</p>
      </div>
      <div className="mx-auto mt-20 max-w-6xl"><Mockup /></div>
    </section>
  );
}

/** Browser-style frame showing the app without screenshots: sidebar, a review card on the canvas, a properties panel. */
function Mockup() {
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl border border-[#171e19]/10 bg-white text-left shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[#171e19]/10 bg-[#f8f9fa] px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" />
        <span className="mx-auto text-xs font-medium text-[#171e19]/50">freshroots · review queue</span>
      </div>
      <div className="grid min-h-80 grid-cols-12">
        <div className="col-span-3 hidden bg-[#171e19] p-4 md:block">
          <div className="display text-xl text-white">Freshroots<span className="text-[#8ff0a4]">.</span></div>
          {["Overview", "Review queue", "Exceptions", "Purchase orders", "Tracker"].map((l, i) => (
            <div key={l} className={`mt-2 rounded-full px-3 py-1.5 text-xs ${i === 1 ? "bg-[#8ff0a4] font-bold text-[#171e19]" : "text-[#b7c6c2]"}`}>{l}</div>
          ))}
        </div>
        <div className="grid-bg relative col-span-12 grid place-items-center bg-[#f8f9fa] p-6 md:col-span-6">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-[0_20px_40px_-24px_rgba(23,30,25,0.45)]">
            <div className="text-xs font-bold">Mango Drink 200ml <span className="ml-1 rounded-full bg-[#ffe5e2] px-2 py-0.5 text-[10px] uppercase text-[#c0261a]">Stockout risk</span></div>
            <div className="display mt-3 text-3xl text-[#c0261a]">Order 750</div>
            <div className="mt-1 text-xs text-[#171e19]/60">Stock lasts 3.4 weeks. Target is 6–14.</div>
            <div className="relative mt-3 h-2 rounded-full bg-[#eef1f0]"><div className="absolute inset-y-0 left-[40%] w-[40%] rounded-full bg-[#dcfce7]" /><div className="absolute -top-1 left-[22%] h-4 w-1.5 rounded-full bg-[#c0261a]" /></div>
            <div className="mt-4 rounded-full bg-[#8ff0a4] py-2 text-center text-xs font-bold">Approve 750</div>
          </div>
          <div className="absolute right-[16%] bottom-[18%] flex items-start gap-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill={ink}><path d="M4 2l16 9-7 2-3 7z" /></svg>
            <span className="rounded-md bg-[#171e19] px-2 py-0.5 text-[10px] font-bold text-white">Raghav</span>
          </div>
        </div>
        <div className="col-span-3 hidden border-l border-[#171e19]/10 p-4 text-xs md:block">
          <div className="display text-lg">Rules</div>
          <div className="mt-3 flex gap-1.5">{["⟸", "≡", "⟹"].map((c) => <span key={c} className="grid size-7 place-items-center rounded-md border border-[#171e19]/10">{c}</span>)}</div>
          <div className="mt-4 space-y-2 text-[#171e19]/70">
            <div className="flex justify-between"><span>High demand</span><b className="text-[#171e19]">+20%</b></div>
            <div className="flex justify-between"><span>Min cover</span><b className="text-[#171e19]">6 wk</b></div>
            <div className="flex justify-between"><span>Max cover</span><b className="text-[#171e19]">14 wk</b></div>
            <div className="flex justify-between"><span>Festival</span><b className="text-[#171e19]">×1.25</b></div>
          </div>
          <div className="display mt-5 text-lg">Accent</div>
          <div className="mt-2 flex items-center gap-2"><span className="size-6 rounded-md bg-[#8ff0a4] ring-1 ring-[#171e19]/10" /><code>#8FF0A4</code></div>
        </div>
      </div>
    </div>
  );
}

function Stack() {
  return (
    <section className="border-y border-[#171e19]/10 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-12 gap-y-4">
        <span className="text-xs font-bold uppercase tracking-widest text-[#171e19]/50">Runs on</span>
        {["SAP", "Postgres", "Gemini", "Zoho Inventory", "Resend", "Vercel"].map((s) => <span key={s} className="display text-2xl text-[#171e19]/45">{s}</span>)}
      </div>
    </section>
  );
}

function Point({ good, children }: { good?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-4 text-lg">
      {good ? (
        <svg role="img" className="mt-1 size-6 shrink-0" viewBox="0 0 24 24" fill="none" aria-label="Yes"><circle cx="12" cy="12" r="11" fill="#8ff0a4" /><path d="M7 12.5l3.2 3.2L17 9" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg role="img" className="mt-1 size-6 shrink-0" viewBox="0 0 24 24" fill="none" aria-label="No"><path d="M6 6l12 12M18 6L6 18" stroke="#ff6b5e" strokeWidth="2.6" strokeLinecap="round" /></svg>
      )}
      <span>{children}</span>
    </li>
  );
}

function OldVsNew() {
  return (
    <section id="case" className="grid md:grid-cols-2">
      <div className="bg-[#171e19] px-6 py-20 md:px-14">
        <h2 className="display text-6xl text-[#b7c6c2]">The old way</h2>
        <ul className="mt-10 space-y-6 text-[#b7c6c2]">
          <Point>One forecast a month, two days of Excel for Raghav</Point>
          <Point>Data already 3–4 weeks old when procurement acts</Point>
          <Point>₹28–34 lakh a quarter lost to stockouts and write-offs</Point>
          <Point>The logic lives in one person’s head</Point>
        </ul>
      </div>
      <div className="border-t-4 border-[#8ff0a4] bg-[#272727] px-6 py-20 md:border-t-0 md:border-l-4 md:px-14">
        <h2 className="display text-6xl text-white">The <span className="text-[#8ff0a4]">Freshroots</span> way</h2>
        <ul className="mt-10 space-y-6 text-white">
          <Point good>Runs itself every Monday and Thursday at 6 am</Point>
          <Point good>Ordering on data no more than 4 days old</Point>
          <Point good>Raghav’s rules, written down and versioned</Point>
          <Point good>Gemini explains, Raghav decides, Zoho gets a draft PO</Point>
        </ul>
      </div>
    </section>
  );
}

function BentoCard({ title, children, dark, wide }: { title: string; children: ReactNode; dark?: boolean; wide?: boolean }) {
  return (
    <div className={`lift flex flex-col overflow-hidden rounded-2xl p-8 ${wide ? "md:col-span-2" : ""} ${dark ? "bg-[#171e19] text-white" : "border border-[#171e19]/10 bg-[#f8f9fa]"}`}>
      <h3 className="display text-3xl">{title}</h3>
      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}

function Bento() {
  return (
    <section id="features" className="px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <h2 className="display max-w-3xl text-6xl md:text-7xl">Rules decide the numbers. <span className="hl">People</span> decide the order.</h2>
        <div className="mt-14 grid gap-4 md:auto-rows-[400px] md:grid-cols-3">
          <BentoCard title="Raghav’s rules, in code" wide>
            <p className="max-w-lg text-[#171e19]/70">The five rules he wrote down, applied to every SKU with no AI in the loop. Every threshold is editable, and every change is versioned.</p>
            <pre className="mt-6 overflow-x-auto rounded-xl bg-[#171e19] p-5 text-sm leading-relaxed text-[#b7c6c2]"><code>{`if (last4wk > avg12wk × 1.20)  flag("HIGH_DEMAND", order: std × 1.5)
if (cover   < 6 weeks)          flag("STOCKOUT_RISK", order: now)
if (cover   > 14 weeks)         flag("OVERSTOCK_RISK", pause)
`}<span className="text-[#8ff0a4]">{`festival(Oct, Nov, Mar) → demand × 1.25   perishable → 3–4 weeks`}</span></code></pre>
          </BentoCard>
          <BentoCard title="Gemini explains" dark>
            <p className="text-[#b7c6c2]">Two lines per flag, from the rule’s own numbers. It can send odd cases to Raghav, never change a quantity.</p>
            <div className="mt-8 space-y-3" aria-hidden>
              <div className="h-3 w-11/12 animate-pulse rounded-full bg-[#8ff0a4]/70" />
              <div className="h-3 w-3/4 animate-pulse rounded-full bg-[#b7c6c2]/30 [animation-delay:150ms]" />
              <div className="h-3 w-5/6 animate-pulse rounded-full bg-[#b7c6c2]/30 [animation-delay:300ms]" />
            </div>
          </BentoCard>
          <BentoCard title="Raghav decides">
            <p className="text-[#171e19]/70">Approve, edit or reject. Edits and rejections need a reason, and every decision is logged.</p>
            <div className="mt-8 flex items-center" aria-hidden>
              {["R", "D", "P"].map((l, i) => <span key={l} className={`display -ml-2 grid size-12 place-items-center rounded-full border-2 border-[#f8f9fa] text-lg grayscale first:ml-0 ${i === 0 ? "bg-[#8ff0a4]" : i === 1 ? "bg-[#171e19] text-white" : "bg-[#b7c6c2]"}`}>{l}</span>)}
              <span className="ml-4 text-sm font-medium text-[#171e19]/60">Planner · Ops · Procurement</span>
            </div>
          </BentoCard>
          <BentoCard title="Draft POs straight into Zoho" wide dark>
            <p className="max-w-lg text-[#b7c6c2]">One draft per supplier through the Zoho Inventory API, with an email to procurement. They confirm it in Zoho; nothing goes to a supplier on its own.</p>
            <div className="mt-6 space-y-2 font-mono text-sm" aria-hidden>
              {[["PO-00001", "Mango Drink × 750", "₹10,500"], ["PO-00002", "Almond Milk × 150", "₹16,500"], ["PO-00003", "Multigrain Bread × 500", "₹19,000"]].map(([n, l, a]) => (
                <div key={n} className="flex items-center justify-between gap-4 rounded-lg bg-white/5 px-4 py-2.5">
                  <span className="text-[#8ff0a4]">{n}</span><span className="flex-1 truncate text-white">{l}</span><span className="text-[#b7c6c2]">{a}</span>
                  <span className="rounded-full bg-[#8ff0a4]/15 px-2 text-xs text-[#8ff0a4]">draft</span>
                </div>
              ))}
            </div>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["Fresh data in", "IT drops the SAP export of sales and stock by SKU and distributor. It is cleaned into Postgres with a report of anything rejected."],
    ["Rules flag, Gemini explains", "Mon and Thu at 6 am the rules check every SKU. Gemini writes the why, and sends anything odd to the exceptions queue."],
    ["Raghav decides, Zoho orders", "He approves, edits or rejects. Approved lines become draft POs in Zoho, and his decisions feed back into the next run."],
  ];
  return (
    <section id="how" className="border-t border-[#171e19]/10 px-6 py-24">
      <div className="mx-auto grid max-w-7xl gap-12 md:grid-cols-3">
        <h2 className="display self-start text-7xl md:sticky md:top-28">How it <span className="hl">works</span></h2>
        <ol className="space-y-6 md:col-span-2">
          {steps.map(([t, d], i) => (
            <li key={t} className="group lift flex gap-8 rounded-2xl border border-[#171e19]/10 p-8">
              <span className="display text-8xl text-[#1f9d55]/20 transition-colors duration-300 group-hover:text-[#1f9d55]">0{i + 1}</span>
              <div className="pt-2">
                <h3 className="display text-4xl">{t}</h3>
                <p className="mt-3 max-w-lg text-lg text-[#171e19]/70">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Quotes() {
  const quotes = [
    { who: "The CEO", role: "Freshroots", text: "Everyone at that conference was talking about AI. I want something running by Q1. You have ₹15 lakhs and 90 days." },
    { who: "Raghav Kulkarni", role: "Senior Demand Planner", text: "If the data were already organised for me, I could run the same analysis twice a week." },
    { who: "Deepa Nair", role: "Head of Operations", text: "The problem isn’t who sees the data — it’s that by the time anyone acts on it, the market has already moved." },
  ];
  return (
    <section className="bg-[#f8f9fa] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-bold uppercase tracking-widest text-[#171e19]/50">In their words · from the case</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {quotes.map((q, i) => (
            <figure key={q.who} className={`lift flex flex-col rounded-2xl p-8 ${i === 1 ? "bg-[#171e19] text-white md:translate-y-4" : "border border-[#171e19]/10 bg-white"}`}>
              <span className="display text-7xl leading-none text-[#1f9d55]" aria-hidden>“</span>
              <blockquote className="mt-2 flex-1 text-lg font-medium">{q.text}</blockquote>
              <figcaption className="mt-8 flex items-center gap-4">
                <span className={`display grid size-12 place-items-center rounded-full text-lg grayscale ${i === 1 ? "bg-white/10" : "bg-[#171e19]/10"}`}>{q.who.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                <span><span className="display block text-xl">{q.who}</span><span className={`text-sm ${i === 1 ? "text-[#b7c6c2]" : "text-[#171e19]/60"}`}>{q.role}</span></span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[#8ff0a4] px-6 py-28 text-center">
      <div aria-hidden className="display pointer-events-none absolute inset-0 flex select-none flex-col justify-center text-[11rem] leading-[0.85] whitespace-nowrap text-[#171e19]/10">
        <span>Monday Thursday Monday</span><span className="-ml-40">Thursday Monday Thursday</span>
      </div>
      <div className="relative mx-auto max-w-4xl">
        <h2 className="display text-6xl md:text-8xl">Stop ordering on last month’s data</h2>
        <p className="mx-auto mt-8 max-w-2xl text-2xl text-[#171e19]/75">The next run is Monday or Thursday at 6 am. Sign in to see what it flagged.</p>
        <a href="#signin" className="display mt-12 inline-block rounded-xl bg-[#171e19] px-12 py-5 text-2xl text-white shadow-xl transition-transform hover:scale-105">Sign in to the dashboard</a>
      </div>
    </section>
  );
}
