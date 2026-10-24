"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string; count?: number }

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 ${
              active ? "bg-[var(--surface-2)] font-semibold" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            }`}
          >
            {i.label}
            {!!i.count && <span className="num rounded-full bg-[var(--accent)] px-1.5 text-xs text-[var(--accent-ink)]">{i.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
