import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Link from "next/link";

import { BlockClock } from "@/components/BlockClock";
import { OfflineBanner } from "@/components/OfflineBanner";
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
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 border-b border-[var(--ring)] bg-[var(--surface)]">
          <div className="mx-auto flex h-12 w-full max-w-[1440px] items-center gap-6 px-6">
            <span className="text-17 font-semibold tracking-[-0.01em]">
              RenewCast
            </span>
            <span
              className="text-11 font-medium text-ink-muted"
              title="Central Electricity Regulatory Commission despatch framework"
            >
              96-block despatch day · IST
            </span>

            <nav className="flex items-center gap-4 text-12">
              <Link href="/" className="underline-offset-4 hover:underline">
                Fleet
              </Link>
              <Link href="/accuracy" className="underline-offset-4 hover:underline">
                Accuracy
              </Link>
            </nav>

            <div className="ml-auto flex items-center gap-4">
              <BlockClock />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-8">
          {children}
        </main>

        <footer className="border-t border-[var(--ring)] px-6 py-4">
          <p className="mx-auto max-w-[1440px] text-11 text-ink-muted">
            Forecasts are probabilistic. Commercial coefficients are indicative
            and configurable.
          </p>
        </footer>

        <OfflineBanner />
      </body>
    </html>
  );
}
