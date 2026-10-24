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
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col md:flex-row">
      <aside className="border-b border-[var(--border)] p-4 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="mb-4">
          <div className="font-semibold">Freshroots</div>
          <div className="text-xs text-[var(--text-3)]">Demand planning</div>
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
        <div className="mt-6 hidden text-xs text-[var(--text-3)] md:block">
          <div>{session.name}</div>
          <div>{session.role === "planner" ? "Planner (can decide)" : "Viewer (read-only)"}</div>
          {authEnabled() && (
            <form action={logout}><button className="mt-1 underline">Sign out</button></form>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
