import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freshroots Demand Planning",
  description: "Rules-based demand planning with Raghav's final call",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/integrations", label: "Integrations" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="font-semibold text-emerald-800">Freshroots · Demand Planning</span>
            <nav className="flex flex-wrap gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-stone-600 hover:text-stone-900">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
