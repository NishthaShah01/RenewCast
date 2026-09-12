"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Light/dark toggle.
 *
 * Deliberately a two-state switch, not a three-state light/dark/system
 * cycle. This is a control-room tool: an operator on a projector needs to
 * force light, and one on a night shift needs to force dark. "Follow the
 * OS" is the default when nothing is stored, and a user who wants it back
 * clears site data — a case rare enough not to earn a third click.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Read the resolved theme after mount. Before mount there is no correct
  // answer to render — the server doesn't know the OS preference — so the
  // label stays blank rather than flickering from a wrong guess.
  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
      return;
    }
    setTheme(
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("rc-theme", next);
    } catch {
      // Blocked storage: the choice applies for this page view only.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // 24px minimum hit target, per the accessibility floor.
      className="h-7 min-w-[72px] rounded-control border border-[var(--ring)] px-3 text-11 font-medium text-ink-secondary transition-colors hover:text-ink-primary"
      aria-label={
        theme ? `Switch to ${theme === "dark" ? "light" : "dark"} theme` : "Switch theme"
      }
    >
      {theme === "dark" ? "Dark" : theme === "light" ? "Light" : " "}
    </button>
  );
}
