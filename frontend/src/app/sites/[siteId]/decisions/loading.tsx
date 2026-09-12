/**
 * Loading state for the despatch plan.
 *
 * The plan is one request with no held frame to fall back on, so a placeholder
 * is honest here. It mirrors the real page's block structure — heading, panel,
 * table — at the real dimensions, so the layout does not jump when the content
 * arrives.
 *
 * Deliberately no spinner. A spinner communicates only that something is
 * happening; the shape of what is coming communicates that and what it will
 * be. `aria-busy` on the region is what a screen reader needs, and the visible
 * text says the same thing in words.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div>
        <p className="text-11 text-ink-muted">Loading forecast</p>
        <div className="mt-2 h-7 w-64 rounded-control bg-[var(--gridline)]" />
        <div className="mt-2 h-4 w-[46ch] max-w-full rounded-control bg-[var(--gridline)]" />
      </div>

      <section className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="border-b border-[var(--gridline)] px-4 py-3">
          <div className="h-4 w-24 rounded-control bg-[var(--gridline)]" />
        </header>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-3 w-20 rounded-control bg-[var(--gridline)]" />
              <div className="mt-2 h-5 w-16 rounded-control bg-[var(--gridline)]" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
