"use client";

/**
 * Global error boundary.
 *
 * Catches unhandled errors across any segment below the root layout.
 * Explains that data or the page could not be loaded, preserves the operational
 * visual language, and offers a Retry action without exposing raw stack traces.
 */
export default function ErrorBoundary({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  const handleRetry = () => {
    if (typeof reset === "function") {
      reset();
    } else if (typeof retry === "function") {
      retry();
    } else {
      window.location.reload();
    }
  };

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 inline-block size-2.5 shrink-0 rounded-full"
          style={{ background: "var(--status-critical)" }}
        />
        <div className="flex-1">
          <h2 className="text-16 font-semibold text-ink-primary">
            Data or page could not be loaded.
          </h2>
          <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">
            The operational service didn&rsquo;t return a usable response or the requested resource is unavailable.
            Retrying will request it again.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-control bg-[var(--ink-primary)] px-4 py-1.5 text-12 font-medium text-[var(--surface)] hover:opacity-90 active:opacity-100"
            >
              Retry
            </button>
            <a
              href="/"
              className="rounded-control border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-secondary hover:bg-[var(--page)] hover:text-ink-primary"
            >
              Return to Command Centre
            </a>
          </div>

          {error.digest ? (
            <p className="mt-4 text-11 text-ink-muted tabular-nums">
              Reference code: {error.digest}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
