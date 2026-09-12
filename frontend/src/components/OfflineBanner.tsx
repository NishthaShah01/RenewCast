"use client";

import { useEffect, useState } from "react";

/**
 * The offline notice.
 *
 * Every screen in this product is a live read from the forecast service, so
 * losing the connection makes all of them stale at once. That is worth saying
 * in one place rather than letting each panel fail separately with its own
 * "can't reach the service" message.
 *
 * ## Why it is fixed rather than in the flow
 *
 * A banner inserted into the document flow pushes the whole page down the
 * moment a connection drops — the numbers an operator is reading move under
 * their eyes. Fixed to the bottom edge, it appears over the footer margin and
 * nothing reflows.
 *
 * ## Why it starts hidden
 *
 * `navigator.onLine` does not exist during the server render, and assuming
 * offline would flash the banner on every first paint. It mounts hidden, reads
 * the real value in an effect, and from then on tracks the events. The false
 * negative case — `onLine` is true but the network is unusable — is left to the
 * API client, which reports unreachable-service errors in its own words.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--ring)] bg-surface px-6 py-2.5"
      style={{ boxShadow: "var(--overlay-shadow)" }}
    >
      <p className="mx-auto flex max-w-[1440px] items-center gap-2 text-12">
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-pill"
          style={{ background: "var(--status-serious)" }}
        />
        You&rsquo;re offline. RenewCast needs a connection to fetch forecasts.
      </p>
    </div>
  );
}
