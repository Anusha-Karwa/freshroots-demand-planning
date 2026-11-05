"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string; count?: number }

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:px-0">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            // Every page reads the database; prefetching all nine on each load slows cold starts on Vercel.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active ? "bg-[var(--green)] font-bold text-[var(--ink)]" : "text-[var(--sage)] hover:bg-white/5 hover:text-white"
            }`}
          >
            {i.label}
            {!!i.count && <span className={`num rounded-full px-2 text-xs font-bold ${active ? "bg-[var(--ink)] text-[var(--green)]" : "bg-[var(--green)] text-[var(--ink)]"}`}>{i.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
