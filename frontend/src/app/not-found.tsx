import Link from "next/link";

/**
 * 404.
 *
 * At the root, so it serves two cases with one file: a `notFound()` thrown by
 * a site page whose id the backend rejected, and any URL that matches no route
 * at all. Both are the same thing to the person reading it — the address is
 * wrong — so both get the same page and the same way out.
 *
 * The link goes to the command centre rather than "back", because a wrong
 * address usually came from a stale link, and back returns to the thing that
 * was stale.
 */
export default function NotFound() {
  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface p-4">
      <h1 className="text-17 font-semibold">That page doesn&rsquo;t exist.</h1>
      <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">
        The address may be mistyped, or the site id may not be one this service
        knows.
      </p>
      <p className="mt-3 text-14">
        <Link href="/" className="font-medium underline underline-offset-4">
          Go to the Command Centre
        </Link>
      </p>
    </section>
  );
}
