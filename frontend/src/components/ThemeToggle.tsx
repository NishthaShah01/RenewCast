"use client";

import { useCallback, useSyncExternalStore } from "react";

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

/* The resolved theme lives in the DOM — the inline script in the layout sets
   `data-theme` before first paint, and the OS preference is a media query.
   Both are external stores, so they are read with the API for reading external
   stores rather than mirrored into state by an effect. The effect version
   worked, but it set state during mount, which is a cascading render. */

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void): () => void {
  const query = media();
  query.addEventListener("change", onChange);

  // `data-theme` is written by `toggle` below and by the pre-paint script.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function getSnapshot(): Theme {
  const stored = document.documentElement.getAttribute("data-theme");
  if (stored === "dark" || stored === "light") return stored;
  return media().matches ? "dark" : "light";
}

/* Null on the server: it cannot know the OS preference, and rendering a guess
   would flash the wrong label on hydration. The button renders blank until the
   client snapshot arrives — the same behaviour as before. */
const getServerSnapshot = (): Theme | null => null;

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("rc-theme", next);
    } catch {
      // Blocked storage: the choice applies for this page view only.
    }
    // No setState — the attribute write above is the change, and the mutation
    // observer in `subscribe` is what tells React to re-read it.
  }, [theme]);

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
      {theme === "dark" ? "Dark" : theme === "light" ? "Light" : " "}
    </button>
  );
}
