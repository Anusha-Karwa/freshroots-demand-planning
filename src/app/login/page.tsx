import { redirect } from "next/navigation";
import { authEnabled, roleForPassword, setSession, clearSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const role = roleForPassword(String(formData.get("password") ?? ""));
  if (!role || !name) redirect("/login?error=1");
  await setSession({ name, role });
  redirect("/");
}

async function logout() {
  "use server";
  await clearSession();
  redirect("/login");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; out?: string }> }) {
  const sp = await searchParams;
  if (!authEnabled()) {
    return (
      <p className="text-sm text-stone-600">
        Login is off in local dev (no <code>DASHBOARD_PASSWORD</code> set) — you are the planner.
      </p>
    );
  }
  if (sp.out) {
    return (
      <form action={logout}>
        <button className="rounded bg-stone-800 px-3 py-1.5 text-sm text-white">Sign out</button>
      </form>
    );
  }
  return (
    <form action={login} className="mx-auto mt-10 max-w-sm space-y-3 rounded border border-stone-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <label className="block text-sm">
        Your name
        <input name="name" required placeholder="e.g. Raghav" className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5" />
      </label>
      <label className="block text-sm">
        Password
        <input name="password" type="password" required className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5" />
      </label>
      {sp.error && <p className="text-sm text-red-700">Name and a valid password are required.</p>}
      <button className="w-full rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white">Sign in</button>
      <p className="text-xs text-stone-500">Planner password: decide and edit rules. Viewer password: read-only.</p>
    </form>
  );
}
