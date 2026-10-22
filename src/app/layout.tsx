import type { Metadata } from "next";
import Link from "next/link";
import { currentUser, authEnabled } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freshroots Demand Planning",
  description: "Rules-based demand planning with Raghav's final call",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/review", label: "Review queue" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/tracker", label: "Tracker" },
  { href: "/rules", label: "Rules" },
  { href: "/data", label: "Data" },
  { href: "/backtest", label: "Backtest" },
  { href: "/integrations", label: "Integrations" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="font-semibold text-emerald-800">Freshroots · Demand Planning</span>
            {user && (
              <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className="text-stone-600 hover:text-stone-900">
                    {n.label}
                  </Link>
                ))}
              </nav>
            )}
            {user && (
              <span className="ml-auto text-xs text-stone-500">
                {user.name} · {user.role}
                {authEnabled() && (
                  <Link href="/login?out=1" className="ml-2 underline">
                    sign out
                  </Link>
                )}
              </span>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
