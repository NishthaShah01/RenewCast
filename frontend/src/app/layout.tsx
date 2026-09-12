import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Link from "next/link";

import { AppNav } from "@/components/AppNav";
import { BlockClock } from "@/components/BlockClock";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageTransition } from "@/components/PageTransition";
import { ThemeToggle } from "@/components/ThemeToggle";

import "./globals.css";

/**
 * One family, IBM Plex Sans, plus the Condensed cut for axis ticks only.
 *
 * Plex is IBM's typeface for technical and industrial products — it carries
 * engineering seriousness without the neutrality of a UI-default grotesque,
 * and its 600 weight is emphatic enough that nothing here needs 700.
 *
 * Weights are declared explicitly because Plex on Google Fonts is a static
 * family: 400 body, 500 labels, 600 headings and numeric values.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "RenewCast — renewable generation forecasting",
  description:
    "Probabilistic 72-hour solar and wind generation forecasts for Indian grid " +
    "operators, aligned to the 96-block despatch day.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/**
 * Applied before first paint so a dark-mode user never sees a white flash.
 *
 * Inlined rather than imported: any module that has to be fetched runs after
 * the first paint by definition, which is exactly the flash this prevents.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var saved = localStorage.getItem('rc-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    /* Private mode or blocked storage: fall through to the OS preference,
       which the CSS already handles on its own. */
  }
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexCondensed.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--ring)] bg-[var(--surface)]">
          <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6">
            {/* LEFT: Brand & Navigation */}
            <div className="flex items-center gap-6 sm:gap-8">
              <Link
                href="/"
                aria-label="RenewCast home"
                className="flex items-center select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] hover:opacity-90 transition-opacity"
              >
                <img
                  src="/logo-dark.png"
                  alt="RenewCast"
                  width={112}
                  height={28}
                  className="rc-logo-dark h-7 w-auto object-contain"
                  loading="eager"
                  decoding="async"
                />
                <img
                  src="/logo-light.png"
                  alt="RenewCast"
                  width={112}
                  height={28}
                  className="rc-logo-light h-7 w-auto object-contain"
                  loading="eager"
                  decoding="async"
                />
              </Link>

              <AppNav />
            </div>

            {/* RIGHT: Current Operational Status & Theme Control */}
            <div className="flex items-center gap-3 sm:gap-4">
              <BlockClock />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8">
          <PageTransition>{children}</PageTransition>
        </main>

        <footer className="border-t border-[var(--ring)] px-6 py-4">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 text-11 text-ink-muted">
            <p>
              Forecasts are probabilistic. Commercial coefficients are indicative
              and configurable.
            </p>
            <Link
              href="/accuracy"
              className="text-ink-secondary hover:text-ink-primary hover:underline transition-colors"
            >
              Model performance
            </Link>
          </div>
        </footer>

        <OfflineBanner />
      </body>
    </html>
  );
}
