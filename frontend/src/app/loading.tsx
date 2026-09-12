/**
 * Global Loading State.
 *
 * Provides a quiet, restrained operational loading indicator using RenewCast's
 * engineering design tokens, without layout jumping.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[400px] w-full flex-col items-center justify-center">
      <div className="rounded-panel border border-[var(--ring)] bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className="size-3 animate-pulse rounded-full"
            style={{ backgroundColor: "var(--ink-primary)" }}
            aria-hidden="true"
          />
          <div>
            <div className="text-14 font-medium text-ink-primary">
              Loading operational data…
            </div>
            <div className="mt-0.5 text-12 text-ink-muted">
              Aligning forecast to despatch horizon
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
