import Link from "next/link";
import { BlockSpine } from "@/components/BlockSpine";
import { Panel, StatusDot, Td, Th, riskToStatus } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { blockStartLabel } from "@/lib/blocks";
import {
  ACTION_LABELS,
  RISK_LABELS,
  mw,
  mwh,
  percent,
  technologyLabel,
} from "@/lib/format";
import type { EnergySummary, RiskLevel, Site } from "@/lib/types";

interface SiteRiskInfo {
  siteId: string;
  riskLevel: RiskLevel;
  severity: number;
  topEventTitle?: string;
  driver?: string;
  peakDeviationMw?: number;
  recommendedAction?: string;
}

export const metadata = {
  title: "Fleet Portfolio — RenewCast",
  description:
    "Overview of connected solar and wind generation assets, portfolio totals, and active operational risk events.",
};

export default async function FleetPage() {
  const [sitesResult, fleetResult] = await Promise.allSettled([
    api.sites(),
    api.fleetSummary(),
  ]);

  const sites =
    sitesResult.status === "fulfilled" ? sitesResult.value.sites : [];
  const fleet =
    fleetResult.status === "fulfilled" ? fleetResult.value : [];

  // Error condition: sites call failed
  if (sitesResult.status === "rejected") {
    const err = sitesResult.reason;
    const msg =
      err instanceof ApiError ? err.message : "Fleet data is unavailable.";
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">Fleet</h1>
          <p className="mt-0.5 text-13 text-ink-secondary">
            Operational overview of connected renewable portfolio assets.
          </p>
        </div>
        <Panel title="Fleet status">
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <h3 className="text-15 font-semibold text-ink-primary">
              Fleet data is unavailable.
            </h3>
            <p className="mt-1 max-w-[50ch] text-13 text-ink-secondary">
              {msg}
            </p>
            <div className="mt-4">
              <a
                href="/fleet"
                className="inline-flex items-center gap-1.5 rounded border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-primary hover:bg-[var(--page)] focus:outline-none"
              >
                <svg
                  className="size-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
                <span>Retry</span>
              </a>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  // Zero sites configured
  if (sites.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">Fleet</h1>
        </div>
        <Panel title="Fleet portfolio">
          <div className="p-8 text-center">
            <h3 className="text-15 font-semibold text-ink-primary">
              No sites are configured.
            </h3>
            <p className="mt-1 text-13 text-ink-secondary">
              No renewable generating plants found in the registry.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  // Concurrently fetch decisions for each site to obtain live operational risk and recommended action
  const decisionsResults = await Promise.allSettled(
    sites.map((s) => api.decisions(s.id, 24)),
  );

  const siteRisks = new Map<string, SiteRiskInfo>();
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const res = decisionsResults[i];
    if (res.status === "fulfilled") {
      const d = res.value;
      const topEvent = d.events && d.events.length > 0 ? d.events[0] : null;
      const topAction = d.actions && d.actions.length > 0 ? d.actions[0] : null;

      const worstBlock = d.blocks.reduce(
        (max, b) => ((b.severity ?? 0) > (max.severity ?? 0) ? b : max),
        d.blocks[0],
      );

      const severity = topEvent ? topEvent.severity : (worstBlock?.severity ?? 0);
      const riskLevel = topEvent ? topEvent.risk_level : (worstBlock?.risk ?? "good");

      siteRisks.set(s.id, {
        siteId: s.id,
        riskLevel,
        severity,
        topEventTitle: topEvent ? `${topEvent.label} (${topEvent.event_type})` : undefined,
        driver: topEvent?.driver ?? (worstBlock?.driver ?? undefined),
        peakDeviationMw:
          topEvent?.peak_deviation_mw ??
          (worstBlock ? Math.abs(worstBlock.deviation_mw) : undefined),
        recommendedAction:
          topEvent?.recommended_action ??
          (topAction
            ? `${ACTION_LABELS[topAction.action] ?? topAction.action}: ${mw(topAction.magnitude_mw)}`
            : undefined),
      });
    }
  }

  // Portfolio Totals calculations
  const totalCapacity = sites.reduce((s, r) => s + r.capacity_mw, 0);
  const totalP50 = fleet.reduce((s, r) => s + r.mwh_p50, 0);
  const totalP10 = fleet.reduce((s, r) => s + r.mwh_p10, 0);
  const totalP90 = fleet.reduce((s, r) => s + r.mwh_p90, 0);

  const solarSites = sites.filter((s) => s.technology === "solar");
  const windSites = sites.filter((s) => s.technology === "wind");

  const solarCapacity = solarSites.reduce((s, r) => s + r.capacity_mw, 0);
  const windCapacity = windSites.reduce((s, r) => s + r.capacity_mw, 0);

  const solarP50 = fleet
    .filter((r) => r.technology === "solar")
    .reduce((s, r) => s + r.mwh_p50, 0);
  const windP50 = fleet
    .filter((r) => r.technology === "wind")
    .reduce((s, r) => s + r.mwh_p50, 0);

  const fleetCf = totalCapacity > 0 ? totalP50 / (totalCapacity * 24) : 0;

  // Active risk count
  const activeRiskSites = sites.filter((s) => {
    const r = siteRisks.get(s.id);
    return r && r.severity >= 25;
  });

  const seriousOrCriticalCount = sites.filter((s) => {
    const r = siteRisks.get(s.id);
    return r && (r.riskLevel === "serious" || r.riskLevel === "critical");
  }).length;

  const watchCount = sites.filter((s) => {
    const r = siteRisks.get(s.id);
    return r && r.riskLevel === "watch";
  }).length;

  // Sites needing attention ranked by severity descending
  const attentionSites = sites
    .map((s) => ({
      site: s,
      risk: siteRisks.get(s.id),
      energy: fleet.find((f) => f.site_id === s.id),
    }))
    .filter((item) => item.risk && item.risk.severity >= 25)
    .sort((a, b) => (b.risk?.severity ?? 0) - (a.risk?.severity ?? 0));

  return (
    <div className="flex flex-col gap-6">
      {/* ── 1. Compact Fleet Header ────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--gridline)] pb-4">
        <div>
          <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">
            Fleet
          </h1>
          <p className="mt-0.5 text-13 text-ink-secondary">
            Portfolio generation and operational status across {sites.length} connected renewable sites.
          </p>
        </div>
        <div className="text-12 font-medium tabular-nums text-ink-muted">
          {sites.length} sites · {mw(totalCapacity)}
        </div>
      </header>

      {/* ── 2. Portfolio Status (Hero Operational Summary) ──────────────────── */}
      <section className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gridline)] px-4 py-3">
          <h2 className="text-14 font-semibold text-ink-primary">Portfolio status</h2>
          {/* Subtle fleet health indicator */}
          <div className="flex flex-wrap items-center gap-3 text-11 font-medium">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <span className="size-2 rounded-full bg-[var(--ink-muted)]" aria-hidden="true" />
              {sites.length} sites active
            </span>
            {seriousOrCriticalCount > 0 ? (
              <span className="flex items-center gap-1.5 font-semibold text-[var(--status-serious)]">
                <span className="size-2 rounded-full bg-[var(--status-serious)]" aria-hidden="true" />
                {seriousOrCriticalCount} serious/critical
              </span>
            ) : null}
            {watchCount > 0 ? (
              <span className="flex items-center gap-1.5 text-[var(--status-warning)]">
                <span className="size-2 rounded-full bg-[var(--status-warning)]" aria-hidden="true" />
                {watchCount} watch
              </span>
            ) : null}
            {seriousOrCriticalCount === 0 && watchCount === 0 ? (
              <span className="flex items-center gap-1.5 text-[var(--status-good)]">
                <span className="size-2 rounded-full bg-[var(--status-good)]" aria-hidden="true" />
                All on plan
              </span>
            ) : null}
          </div>
        </header>

        {/* Clean horizontal operational summary */}
        <div className="grid grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--gridline)] sm:grid-cols-3 lg:grid-cols-6">
          {/* 1. Expected generation */}
          <div className="flex flex-col gap-1 p-4">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Expected generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(totalP50)}
            </div>
            <span className="text-11 text-ink-muted">
              P50 · {mwh(totalP10)}–{mwh(totalP90)}
            </span>
          </div>

          {/* 2. Installed capacity */}
          <div className="flex flex-col gap-1 p-4">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Installed capacity
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mw(totalCapacity)}
            </div>
            <span className="text-11 text-ink-muted">
              {sites.length} generating assets
            </span>
          </div>

          {/* 3. Active risk events (Hero focus) */}
          <div className="flex flex-col gap-1 p-4 bg-[var(--page)]/25">
            <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
              Active risk events
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-20 font-semibold tabular-nums text-[var(--status-serious)]">
                {activeRiskSites.length} / {sites.length}
              </span>
              <span className="text-12 font-medium text-ink-secondary">sites</span>
            </div>
            <span className="text-11 font-medium text-[var(--status-serious)]">
              {seriousOrCriticalCount > 0
                ? `${seriousOrCriticalCount} serious/critical`
                : activeRiskSites.length > 0
                  ? "Watch status"
                  : "All on schedule"}
            </span>
          </div>

          {/* 4. Solar */}
          <div className="flex flex-col gap-1 p-4">
            <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wider text-ink-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: "#601D49" }} aria-hidden="true" />
              Solar
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(solarP50)}
            </div>
            <span className="text-11 text-ink-muted">
              {solarSites.length} sites · {mw(solarCapacity)}
            </span>
          </div>

          {/* 5. Wind */}
          <div className="flex flex-col gap-1 p-4">
            <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wider text-ink-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: "#BD5579" }} aria-hidden="true" />
              Wind
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(windP50)}
            </div>
            <span className="text-11 text-ink-muted">
              {windSites.length} sites · {mw(windCapacity)}
            </span>
          </div>

          {/* 6. Capacity factor (Secondary) */}
          <div className="flex flex-col gap-1 p-4">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Capacity factor
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {percent(fleetCf)}
            </div>
            <span className="text-11 text-ink-muted">
              Fleet weighted avg
            </span>
          </div>
        </div>
      </section>

      {/* ── 3. Primary Exception View: Sites Needing Attention ──────────────── */}
      <SitesNeedingAttention items={attentionSites} />

      {/* ── 4. Technology Mix ──────────────────────────────────────────────── */}
      <TechnologyComparison
        solarCapacity={solarCapacity}
        windCapacity={windCapacity}
        totalCapacity={totalCapacity}
        solarP50={solarP50}
        windP50={windP50}
        totalP50={totalP50}
        solarSitesCount={solarSites.length}
        windSitesCount={windSites.length}
      />

      {/* ── 5. Connected Assets Table ───────────────────────────────────────── */}
      <FleetTable sites={sites} fleet={fleet} siteRisks={siteRisks} />

      {/* ── 6. Operations Timing (Secondary) ────────────────────────────────── */}
      <Panel
        title="Operations timing"
        meta="96-block CERC despatch framework · IST"
        footnote="Indian grid despatch operates on 15-minute time blocks. Gate closure enforces revision deadlines 6 blocks in advance of physical delivery."
      >
        <div className="px-4 py-4">
          <BlockSpine />
        </div>
      </Panel>
    </div>
  );
}

/* ── Sites Needing Attention (Hero Content) ────────────────────────────── */

function SitesNeedingAttention({
  items,
}: {
  items: Array<{
    site: Site;
    risk?: SiteRiskInfo;
    energy?: EnergySummary;
  }>;
}) {
  if (items.length === 0) {
    return (
      <section className="rounded-panel border border-[var(--ring)] bg-surface p-4">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] pb-3">
          <h2 className="text-14 font-semibold text-ink-primary">Sites needing attention</h2>
          <span className="text-11 text-ink-muted">0 sites at risk</span>
        </header>
        <p className="pt-3 text-13 text-ink-secondary">
          All sites are operating within standard declared schedule parameters.
          No high-severity operational deviations detected.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-baseline justify-between gap-4 border-b border-[var(--gridline)] px-4 py-3">
        <div>
          <h2 className="text-14 font-semibold text-ink-primary">Sites needing attention</h2>
          <p className="mt-0.5 text-11 text-ink-muted">
            Triage order: ranked by severity (0–100) across active operational events.
          </p>
        </div>
        <span className="text-11 font-medium text-ink-muted">
          {items.length} of 5 flagged
        </span>
      </header>

      <div className="divide-y divide-[var(--gridline)]">
        {items.map(({ site, risk }) => {
          if (!risk) return null;
          const statusLevel = riskToStatus(risk.riskLevel);
          return (
            <div
              key={site.id}
              className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--page)]/30 lg:flex-row lg:items-center lg:justify-between"
            >
              {/* Site identity & Event details */}
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                {/* Row 1: Site name + State + Risk badge */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    href={`/sites/${site.id}`}
                    className="text-14 font-semibold text-ink-primary hover:underline"
                  >
                    {site.name}
                  </Link>
                  <span className="text-11 text-ink-muted">{site.state}</span>
                  <span
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-11 font-medium capitalize"
                    style={{
                      backgroundColor: `color-mix(in srgb, var(--status-${statusLevel}) 12%, transparent)`,
                      color: `var(--status-${statusLevel})`,
                      border: `1px solid color-mix(in srgb, var(--status-${statusLevel}) 25%, transparent)`,
                    }}
                  >
                    <StatusDot level={statusLevel} />
                    {RISK_LABELS[risk.riskLevel] ?? risk.riskLevel} {risk.severity}
                  </span>
                </div>

                {/* Row 2: Event timing, type & peak deviation */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-ink-secondary">
                  {risk.topEventTitle && (
                    <span className="font-medium text-ink-primary">
                      {risk.topEventTitle}
                    </span>
                  )}
                  {risk.peakDeviationMw !== undefined && (
                    <>
                      <span className="text-ink-muted" aria-hidden="true">·</span>
                      <span>
                        Peak deviation:{" "}
                        <strong className="font-semibold tabular-nums text-ink-primary">
                          {mw(risk.peakDeviationMw)}
                        </strong>
                      </span>
                    </>
                  )}
                  {risk.driver && (
                    <>
                      <span className="text-ink-muted" aria-hidden="true">·</span>
                      <span className="truncate max-w-[65ch] text-ink-secondary" title={risk.driver}>
                        {risk.driver}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Action column & single navigation CTA */}
              <div className="flex items-center gap-4 shrink-0 pt-2 lg:pt-0 border-t border-[var(--gridline)] lg:border-t-0">
                {risk.recommendedAction && (
                  <div className="text-right hidden sm:block">
                    <span className="text-11 text-ink-muted block">Recommended action</span>
                    <span className="text-12 font-medium text-ink-primary">
                      {risk.recommendedAction}
                    </span>
                  </div>
                )}
                <Link
                  href={`/sites/${site.id}/decisions`}
                  className="rounded border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-primary hover:bg-[var(--page)] hover:border-ink-primary transition-colors inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Review plan</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Technology Mix (Compact 2-Column Comparison) ──────────────────────── */

function TechnologyComparison({
  solarCapacity,
  windCapacity,
  totalCapacity,
  solarP50,
  windP50,
  totalP50,
  solarSitesCount,
  windSitesCount,
}: {
  solarCapacity: number;
  windCapacity: number;
  totalCapacity: number;
  solarP50: number;
  windP50: number;
  totalP50: number;
  solarSitesCount: number;
  windSitesCount: number;
}) {
  const solarCapPct =
    totalCapacity > 0 ? (solarCapacity / totalCapacity) * 100 : 0;
  const windCapPct =
    totalCapacity > 0 ? (windCapacity / totalCapacity) * 100 : 0;

  const solarGenPct = totalP50 > 0 ? (solarP50 / totalP50) * 100 : 0;
  const windGenPct = totalP50 > 0 ? (windP50 / totalP50) * 100 : 0;

  // Power-system operational colours for technology comparison
  const SOLAR_COLOR = "#601D49";
  const WIND_COLOR = "#BD5579";

  return (
    <Panel
      title="Technology mix"
      meta="Solar vs Wind portfolio balance"
      footnote="Solar capacity in Rajasthan, Karnataka, and Gujarat · Wind capacity in Tamil Nadu and Rajasthan."
    >
      <div className="flex flex-col gap-5 p-4">
        {/* Compact 2-column comparison cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Solar PV Card */}
          <div className="flex items-center justify-between rounded border border-[var(--gridline)] bg-[var(--page)]/30 p-3">
            <div className="flex items-center gap-2.5">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: SOLAR_COLOR }}
                aria-hidden="true"
              />
              <div>
                <div className="text-13 font-semibold text-ink-primary">Solar PV</div>
                <div className="text-11 text-ink-muted">{solarSitesCount} sites</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-13 font-semibold tabular-nums text-ink-primary">
                {mw(solarCapacity)}
              </div>
              <div className="text-11 tabular-nums text-ink-muted">
                {mwh(solarP50)} ({solarGenPct.toFixed(1)}% gen)
              </div>
            </div>
          </div>

          {/* Wind Card */}
          <div className="flex items-center justify-between rounded border border-[var(--gridline)] bg-[var(--page)]/30 p-3">
            <div className="flex items-center gap-2.5">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: WIND_COLOR }}
                aria-hidden="true"
              />
              <div>
                <div className="text-13 font-semibold text-ink-primary">Wind</div>
                <div className="text-11 text-ink-muted">{windSitesCount} sites</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-13 font-semibold tabular-nums text-ink-primary">
                {mw(windCapacity)}
              </div>
              <div className="text-11 tabular-nums text-ink-muted">
                {mwh(windP50)} ({windGenPct.toFixed(1)}% gen)
              </div>
            </div>
          </div>
        </div>

        {/* Two thin proportion bars */}
        <div className="flex flex-col gap-3 border-t border-[var(--gridline)] pt-3">
          {/* Installed Capacity Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-11">
              <span className="font-medium text-ink-secondary">Installed capacity</span>
              <span className="tabular-nums text-ink-muted">
                Solar {solarCapPct.toFixed(1)}% · Wind {windCapPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-sm bg-[var(--gridline)]">
              <div
                className="h-full rounded-l-sm"
                style={{ width: `${solarCapPct}%`, backgroundColor: SOLAR_COLOR }}
                title={`Solar: ${solarCapPct.toFixed(1)}%`}
              />
              <div
                className="h-full rounded-r-sm"
                style={{ width: `${windCapPct}%`, backgroundColor: WIND_COLOR }}
                title={`Wind: ${windCapPct.toFixed(1)}%`}
              />
            </div>
          </div>

          {/* Expected Energy Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-11">
              <span className="font-medium text-ink-secondary">Expected energy (P50)</span>
              <span className="tabular-nums text-ink-muted">
                Solar {solarGenPct.toFixed(1)}% · Wind {windGenPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-sm bg-[var(--gridline)]">
              <div
                className="h-full rounded-l-sm"
                style={{ width: `${solarGenPct}%`, backgroundColor: SOLAR_COLOR }}
                title={`Solar: ${solarGenPct.toFixed(1)}%`}
              />
              <div
                className="h-full rounded-r-sm"
                style={{ width: `${windGenPct}%`, backgroundColor: WIND_COLOR }}
                title={`Wind: ${windGenPct.toFixed(1)}%`}
              />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ── Main Fleet Table (Connected Assets Registry) ──────────────────────── */

function FleetTable({
  sites,
  fleet,
  siteRisks,
}: {
  sites: Site[];
  fleet: EnergySummary[];
  siteRisks: Map<string, SiteRiskInfo>;
}) {
  const byId = new Map(fleet.map((r) => [r.site_id, r]));
  const maxEnergy = Math.max(1, ...fleet.map((r) => r.mwh_p50));

  const ordered = [...sites].sort(
    (a, b) => (byId.get(b.id)?.mwh_p50 ?? -1) - (byId.get(a.id)?.mwh_p50 ?? -1),
  );

  return (
    <Panel
      title="Connected assets"
      meta={`${sites.length} sites in portfolio`}
      footnote="Click any site name to inspect real-time forecasts, historical actuals, and priced despatch revisions."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead>
            <tr className="border-b border-[var(--gridline)]">
              <Th>Site</Th>
              <Th>Technology</Th>
              <Th numeric>Capacity</Th>
              <Th numeric>Expected Energy</Th>
              <Th width="140px">Relative</Th>
              <Th numeric>Peak Output</Th>
              <Th numeric>Capacity Factor</Th>
              <Th>Risk / Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((site) => {
              const energy = byId.get(site.id);
              const risk = siteRisks.get(site.id);
              const statusLevel = risk ? riskToStatus(risk.riskLevel) : "good";
              const isSolar = site.technology === "solar";

              return (
                <tr
                  key={site.id}
                  className="border-b border-[var(--gridline)] transition-colors hover:bg-[var(--page)]/30 last:border-0"
                >
                  <Td>
                    <Link
                      href={`/sites/${site.id}`}
                      className="font-medium text-ink-primary underline-offset-2 hover:underline"
                    >
                      {site.name}
                    </Link>
                    <span className="ml-2 text-11 text-ink-muted">{site.state}</span>
                  </Td>

                  <Td>
                    <span className="inline-flex items-center gap-1.5 rounded border border-[var(--gridline)] bg-[var(--page)] px-2 py-0.5 text-11 font-medium">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          background: isSolar ? "#601D49" : "#BD5579",
                        }}
                      />
                      {technologyLabel(site.technology)}
                    </span>
                  </Td>

                  <Td numeric>{mw(site.capacity_mw)}</Td>

                  {energy ? (
                    <>
                      <Td numeric>
                        <span className="font-medium tabular-nums">
                          {mwh(energy.mwh_p50)}
                        </span>
                        <div className="text-11 text-ink-muted">
                          {mwh(energy.mwh_p10)}–{mwh(energy.mwh_p90)}
                        </div>
                      </Td>
                      <Td>
                        <EnergyBar row={energy} max={maxEnergy} />
                      </Td>
                      <Td numeric>
                        <span className="tabular-nums">{mw(energy.peak_mw)}</span>
                        <div className="text-11 text-ink-muted tabular-nums">
                          {blockStartLabel(energy.peak_block)}
                        </div>
                      </Td>
                      <Td numeric>{percent(energy.mean_capacity_factor)}</Td>
                    </>
                  ) : (
                    <>
                      <Td numeric muted>—</Td>
                      <Td muted>—</Td>
                      <Td numeric muted>—</Td>
                      <Td numeric muted>—</Td>
                    </>
                  )}

                  <Td>
                    {risk ? (
                      <span className="inline-flex items-center gap-1.5 text-12 font-medium">
                        <StatusDot level={statusLevel} />
                        <span className="capitalize">
                          {RISK_LABELS[risk.riskLevel] ?? risk.riskLevel}
                        </span>
                        {risk.severity > 0 && (
                          <span className="text-11 text-ink-muted">
                            ({risk.severity})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-12 text-ink-muted">—</span>
                    )}
                  </Td>

                  <Td>
                    <Link
                      href={`/sites/${site.id}/decisions`}
                      className="text-12 font-medium text-ink-secondary hover:text-ink-primary hover:underline whitespace-nowrap"
                    >
                      Review plan →
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ── Energy Bar ─────────────────────────────────────────────────────────── */

function EnergyBar({ row, max }: { row: EnergySummary; max: number }) {
  const pct = (v: number) => `${Math.max((v / max) * 100, 0.5)}%`;

  return (
    <span
      className="relative flex h-3 w-full items-center"
      title={`${mwh(row.mwh_p10)} to ${mwh(row.mwh_p90)}`}
    >
      <span
        aria-hidden
        className="absolute h-3"
        style={{
          left: pct(row.mwh_p10),
          width: `calc(${pct(row.mwh_p90)} - ${pct(row.mwh_p10)})`,
          background: "var(--seq-150)",
        }}
      />
      <span
        aria-hidden
        className="absolute h-3 w-[2px]"
        style={{ left: pct(row.mwh_p50), background: "var(--series-1)" }}
      />
      <span className="sr-only">
        {mwh(row.mwh_p50)}, 80% interval {mwh(row.mwh_p10)} to {mwh(row.mwh_p90)}
      </span>
    </span>
  );
}
