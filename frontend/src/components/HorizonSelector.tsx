"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import {
  DEFAULT_HORIZON,
  HORIZON_OPTIONS,
  HORIZON_PARAM,
  horizonLabel,
  type Horizon,
} from "@/lib/horizon";

/**
 * The forecast window control.
 *
 * A segmented control rather than a dropdown: three options, always visible,
 * one click to switch. The current value is in the URL, so this component owns
 * no state of its own and cannot drift out of step with what the server just
 * rendered.
 *
 * ## Why the previous frame stays on screen
 *
 * Switching horizon re-runs the server component, which takes as long as the
 * weather API does. `useTransition` marks that navigation non-urgent, so React
 * keeps the current forecast painted until the new one is ready instead of
 * tearing it down for a skeleton. The only feedback is a dim on the control
 * itself — the chart below never unmounts, so nothing moves.
 *
 * `scroll: false` matters for the same reason: the default is to jump to the
 * top, and an operator who has scrolled to the evening blocks should not be
 * thrown back to the header for changing the window.
 */
export function HorizonSelector({ value }: { value: Horizon }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(next: Horizon) {
    if (next === value) return;

    const params = new URLSearchParams(searchParams);
    // The default is the absence of the parameter, not `?horizon=24`. Keeps
    // the canonical URL clean and makes a shared link say only what differs.
    if (next === DEFAULT_HORIZON) {
      params.delete(HORIZON_PARAM);
    } else {
      params.set(HORIZON_PARAM, String(next));
    }

    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      role="group"
      aria-label="Forecast window"
      aria-busy={pending}
      className="inline-flex items-center overflow-hidden rounded-control border border-[var(--ring)]"
      style={{ opacity: pending ? 0.6 : 1 }}
    >
      {HORIZON_OPTIONS.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => select(option)}
            className="border-r border-[var(--gridline)] px-2.5 py-1 text-11 font-medium tabular-nums last:border-r-0"
            style={
              active
                ? { background: "var(--ink-primary)", color: "var(--surface)" }
                : { color: "var(--ink-secondary)" }
            }
          >
            {horizonLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
