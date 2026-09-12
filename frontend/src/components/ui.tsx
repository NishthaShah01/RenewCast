import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The shared primitives.
 *
 * These were inlined in the Phase 0 page. Three surfaces now need the same
 * panel chrome, the same table cells and the same status mark, and three
 * copies of a border rule is how a design system quietly stops being one.
 *
 * Every rule here is from README_UI.md §5:
 *
 *   - panels get `rounded-panel`, tables and grid cells stay square
 *   - the 1.08:1 surface lift and a 10% ring are the only panel separators;
 *     static content has no shadow
 *   - status is always icon + text label + colour, never colour alone
 */

/* ── Panel ───────────────────────────────────────────────────────────────
   A titled surface. The header rule is `--gridline`, one step lighter than
   the panel's own `--ring`, so the panel reads as one object rather than as
   two stacked boxes. */

export function Panel({
  title,
  meta,
  children,
  footnote,
  action,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-baseline justify-between gap-4 border-b border-[var(--gridline)] px-4 py-3">
        <h2 className="text-14 font-semibold">{title}</h2>
        {action ?? (meta ? <span className="text-11 text-ink-muted tabular-nums">{meta}</span> : null)}
      </header>
      {children}
      {footnote ? (
        <p className="border-t border-[var(--gridline)] px-4 py-3 text-11 text-ink-muted">
          {footnote}
        </p>
      ) : null}
    </section>
  );
}

/* ── Table ───────────────────────────────────────────────────────────── */

export function Th({
  children,
  numeric = false,
  width,
}: {
  children: ReactNode;
  numeric?: boolean;
  width?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-11 font-medium text-ink-muted ${numeric ? "text-right" : "text-left"}`}
      style={width ? { width } : undefined}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric = false,
  muted = false,
  className = "",
}: {
  children: ReactNode;
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      // Tabular figures in columns only — `font-variant-numeric` on Plex Sans,
      // not a switch to a monospace face.
      className={`px-4 py-2.5 ${numeric ? "text-right tabular-nums" : ""} ${
        muted ? "text-ink-secondary" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

/* ── Status ──────────────────────────────────────────────────────────────
   Light-mode warning measures 1.78:1 and serious 2.57:1, both below 3:1 by
   design. The mark is therefore never the only carrier of meaning: every use
   site pairs it with the word. */

export type StatusLevel = "good" | "warning" | "serious" | "critical";

export function StatusDot({ level }: { level: StatusLevel }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-pill"
      style={{ background: `var(--status-${level})` }}
    />
  );
}

/** Risk as it comes off the decisions API, which uses `watch` where the
 *  status tokens use `warning`. Mapped in one place. */
export function riskToStatus(risk: string): StatusLevel {
  return risk === "watch" ? "warning" : (risk as StatusLevel);
}

/* ── Stat ────────────────────────────────────────────────────────────────
   A label, a value and an optional note. The value is 17px semibold; a
   dashboard that sets every figure at 34px has no hierarchy left for the one
   number that matters. */

export function Stat({
  label,
  value,
  note,
  status,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  status?: StatusLevel;
  tone?: "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "var(--delta-pos)"
      : tone === "negative"
        ? "var(--delta-neg)"
        : undefined;

  return (
    <div>
      <dt className="text-11 font-medium text-ink-muted">{label}</dt>
      <dd
        className="mt-1 flex items-center gap-2 text-17 font-semibold tabular-nums"
        style={color ? { color } : undefined}
      >
        {status ? <StatusDot level={status} /> : null}
        {value}
      </dd>
      {note ? <p className="mt-1 text-11 text-ink-muted">{note}</p> : null}
    </div>
  );
}

/* ── Error and empty states ──────────────────────────────────────────────
   An error names what happened and what to do about it, in the interface's
   voice. It does not apologise and it is never vague. An empty screen is an
   invitation to act. */

export function ServiceDown({
  title = "Forecast service unavailable",
  message,
  hint,
  onRetry,
}: {
  title?: string;
  message: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="mt-1.5">
          <StatusDot level="critical" />
        </span>
        <div className="flex-1">
          <h2 className="text-14 font-semibold">{title}</h2>
          <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">{message}</p>
          {hint ? <p className="mt-2 max-w-[72ch] text-12 text-ink-muted">{hint}</p> : null}
          <div className="mt-3 flex items-center gap-3">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-control bg-[var(--ink-primary)] px-3 py-1.5 text-12 font-medium text-[var(--surface)] hover:opacity-90 active:opacity-100"
              >
                Retry
              </button>
            ) : (
              <a
                href=""
                className="rounded-control bg-[var(--ink-primary)] px-3 py-1.5 text-12 font-medium text-[var(--surface)] hover:opacity-90 active:opacity-100"
              >
                Retry
              </a>
            )}
            <Link
              href="/"
              className="rounded-control border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-secondary hover:bg-[var(--page)] hover:text-ink-primary"
            >
              Return to Fleet
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A caveat the payload asked us to show.
 *
 * `degraded`, `notes` and `schedule_basis` all travel in the API response
 * precisely so the UI cannot present a physics-only run or a simulated
 * schedule as something it is not. Rendering them is not optional.
 */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-12 text-ink-secondary">
      <span className="mt-1.5">
        <StatusDot level="warning" />
      </span>
      <span className="max-w-[86ch]">{children}</span>
    </p>
  );
}
