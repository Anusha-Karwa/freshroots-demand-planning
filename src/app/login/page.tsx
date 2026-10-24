import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authEnabled } from "@/lib/auth/session";
import { param, type SearchParams } from "@/lib/page";
import { login } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  await connection(); // passwords are read at request time, not baked in at build
  if (!authEnabled()) redirect("/");
  const sp = await searchParams;
  const err = param(sp.err);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <div>
          <h1 className="text-lg font-semibold">Freshroots demand planning</h1>
          <p className="text-[var(--text-2)]">Planner password to decide; viewer password for read-only.</p>
        </div>
        {err && <div role="alert" className="rounded-md bg-[var(--bad-bg)] px-3 py-2 text-[var(--bad)]">{err}</div>}
        <input type="hidden" name="next" value={param(sp.next) ?? "/"} />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--text-2)]">Your name (recorded with every decision)</span>
          <input name="name" required autoComplete="name" className="w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--text-2)]">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="w-full" />
        </label>
        <button className="w-full rounded-md bg-[var(--accent)] px-3 py-2 font-medium text-[var(--accent-ink)]">Sign in</button>
      </form>
    </main>
  );
}
