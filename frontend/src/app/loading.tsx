/**
 * Global Loading Shell.
 *
 * Provides a quiet, restrained operational placeholder matching RenewCast's
 * panel and grid geometry, avoiding giant page-wide spinners and layout shifts.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6 w-full animate-pulse opacity-85" aria-busy="true">
      {/* Header Placeholder */}
      <header className="border-b border-[var(--gridline)] pb-3">
        <div className="h-6 w-48 rounded bg-[var(--ring)]" />
        <div className="mt-2 h-3.5 w-80 rounded bg-[var(--ring)]/60" />
      </header>

      {/* KPI / Primary Status Strip */}
      <div className="rounded-panel border border-[var(--ring)] bg-surface p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--gridline)]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 p-2">
              <div className="h-3 w-20 rounded bg-[var(--ring)]/60" />
              <div className="h-7 w-28 rounded bg-[var(--ring)]" />
              <div className="h-3 w-24 rounded bg-[var(--ring)]/40" />
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area / Chart Placeholder */}
      <div className="rounded-panel border border-[var(--ring)] bg-surface">
        <div className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-3">
          <div className="h-4 w-36 rounded bg-[var(--ring)]" />
          <div className="h-4 w-24 rounded bg-[var(--ring)]/50" />
        </div>
        <div className="p-6">
          <div className="flex flex-col gap-3">
            <div className="h-4 w-full rounded bg-[var(--ring)]/30" />
            <div className="h-4 w-5/6 rounded bg-[var(--ring)]/25" />
            <div className="h-32 w-full rounded bg-[var(--page)]/60 border border-[var(--gridline)]" />
            <div className="h-4 w-2/3 rounded bg-[var(--ring)]/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
