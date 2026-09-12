"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

interface NavItem {
  name: string;
  href: string;
  isActive: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    name: "Command Centre",
    href: "/",
    isActive: (path) => path === "/",
  },
  {
    name: "Portfolio",
    href: "/fleet",
    isActive: (path) => path === "/fleet" || path.startsWith("/sites"),
  },
  {
    name: "Simulator",
    href: "/simulator",
    isActive: (path) => path.startsWith("/simulator"),
  },
  {
    name: "Historical Data",
    href: "/ingest",
    isActive: (path) => path.startsWith("/ingest"),
  },
];

export function AppNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="flex items-center gap-1 sm:gap-1.5" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.name}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-14 items-center px-2.5 sm:px-3 text-13 transition-colors duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] select-none ${
              active
                ? "font-medium text-ink-primary"
                : "font-normal text-ink-secondary hover:text-ink-primary hover:bg-[var(--page)]/50 rounded"
            }`}
          >
            {item.name}
            {active && (
              <motion.span
                layoutId="activeNavIndicator"
                className="absolute bottom-0 left-2 right-2 h-[2px] bg-ink-primary"
                transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
