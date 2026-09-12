/**
 * Loading state for the accuracy page.
 *
 * Same reasoning as the despatch plan's: one request, no previous frame, so a
 * structural placeholder at the real dimensions rather than a spinner.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div>
        <p className="text-11 text-ink-muted">Loading accuracy metrics</p>
        <div className="mt-2 h-7 w-56 rounded-control bg-[var(--gridline)]" />
        <div className="mt-2 h-4 w-[60ch] max-w-full rounded-control bg-[var(--gridline)]" />
      </div>

      {[0, 1].map((panel) => (
        <section key={panel} className="rounded-panel border border-[var(--ring)] bg-surface">
          <header className="border-b border-[var(--gridline)] px-4 py-3">
            <div className="h-4 w-28 rounded-control bg-[var(--gridline)]" />
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
      ))}
    </div>
  );
}
