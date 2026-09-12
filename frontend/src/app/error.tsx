"use client";

/**
 * The error boundary.
 *
 * A client component by requirement — the boundary has to run on the client to
 * catch a render that failed there. It covers every route below the root
 * layout, so the header, nav and footer stay on screen and only the content
 * region is replaced.
 *
 * ## What it does not do
 *
 * It does not print `error.message`. Server-side messages are redacted to a
 * digest in production, and the ones that are not redacted are stack-shaped
 * text no operator can act on. The API client already writes its failures in
 * the interface's voice and the pages render those inline; anything reaching
 * this boundary is by definition the case we could not name, so it says so and
 * offers the one useful action.
 *
 * `retry` re-runs the failed segment on the server. It replaced `reset` as the
 * recommended prop in 16.3 — `reset` still exists, but retry is the one that
 * re-attempts the render rather than only clearing the error state.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 inline-block size-2 shrink-0 rounded-pill"
          style={{ background: "var(--status-critical)" }}
        />
        <div>
          <h2 className="text-14 font-semibold">
            Forecast data is unavailable right now.
          </h2>
          <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">
            The service didn&rsquo;t return a usable response. Retrying will
            request it again.
          </p>

          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-control px-3 py-1.5 text-12 font-medium text-[var(--surface)]"
            style={{ background: "var(--ink-primary)" }}
          >
            Retry
          </button>

          {/* The digest is the only handle support has on a redacted
              production error. Shown quietly, never as the headline. */}
          {error.digest ? (
            <p className="mt-3 text-11 text-ink-muted tabular-nums">
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
