import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { authEnabled } from "@/lib/auth/session";
import { latestRun } from "@/lib/forecast/run";
import { pageDb } from "@/lib/page";
import { Nav } from "@/components/Nav";
import { logout } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const db = await pageDb();
  const run = await latestRun(db);
  const pending = run
    ? await db.select({ queue: schema.runItems.queue }).from(schema.runItems)
      .where(and(eq(schema.runItems.runId, run.id), eq(schema.runItems.decision, "pending")))
    : [];
  const count = (q: string) => pending.filter((p) => p.queue === q).length;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-[var(--ink)] p-4 text-[var(--sage)] md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:p-6">
        <div className="mb-4 md:mb-10">
          <div className="display text-3xl text-white">Freshroots<span className="text-[var(--green)]">.</span></div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-[var(--sage)]/70">Demand planning</div>
        </div>
        <Nav items={[
          { href: "/", label: "Overview" },
          { href: "/review", label: "Review queue", count: count("review") },
          { href: "/exceptions", label: "Exceptions", count: count("exception") },
          { href: "/purchase-orders", label: "Purchase orders" },
          { href: "/tracker", label: "Tracker" },
          { href: "/rules", label: "Rules config" },
          { href: "/backtest", label: "Backtest" },
          { href: "/data", label: "Data" },
          { href: "/integrations", label: "Integrations" },
        ]} />
        <div className="mt-auto hidden border-t border-[var(--sage)]/10 pt-5 text-sm md:block">
          <div className="flex items-center gap-3">
            <span className="display grid size-10 place-items-center rounded-full bg-[var(--green)] text-lg text-[var(--ink)]" aria-hidden>{session.name.slice(0, 1)}</span>
            <div className="min-w-0">
              <div className="truncate font-bold text-white">{session.name}</div>
              <div className="text-xs">{session.role === "planner" ? "Planner · can decide" : "Viewer · read-only"}</div>
            </div>
          </div>
          {authEnabled() && (
            <form action={logout}><button className="mt-3 text-xs underline decoration-[var(--sage)]/40 underline-offset-4 hover:text-white">Sign out</button></form>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="grid-bg border-b border-[var(--border)]"><div className="mx-auto h-3 max-w-6xl md:h-6" /></div>
        <div className="mx-auto max-w-6xl p-4 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
