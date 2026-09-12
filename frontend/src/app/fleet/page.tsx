import Link from "next/link";
import { BlockSpine } from "@/components/BlockSpine";
import { Panel, StatusDot, Td, Th, riskToStatus } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { blockOf, blockStartLabel, revisionHorizonBlock } from "@/lib/blocks";
import {
  ACTION_LABELS,
  RISK_LABELS,
  mw,
  mwh,
  percent,
  technologyLabel,
} from "@/lib/format";
import type { EnergySummary, Site } from "@/lib/types";
import {
  SitesNeedingAttention,
  OperationsTimingCollapsible,
  type SiteRiskInfo,
} from "./FleetClientSections";

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

  // Active risk counts
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

  // Timing metrics for collapsed operations line
  const now = new Date();
  const curBlock = blockOf(now);
  const horizBlock = revisionHorizonBlock(now);
  const actBlocks = Math.max(0, 96 - horizBlock + 1);

  return (
    <div className="flex flex-col gap-5">
      {/* ── 1. Compact Fleet Header ────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--gridline)] pb-3">
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

      {/* ── 2. Portfolio status (One compact summary band) ───────────────────── */}
      <section className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gridline)] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-14 font-semibold text-ink-primary">Portfolio status</h2>
            {/* Subtle fleet health indicator */}
            <span className="text-11 font-medium text-ink-muted">
              ● {sites.length} sites active · {seriousOrCriticalCount} serious/critical · {watchCount} watch
            </span>
          </div>
          <span className="text-11 tabular-nums text-ink-muted">
            80% interval: {mwh(totalP10)}–{mwh(totalP90)}
          </span>
        </header>

        {/* Compact horizontal operational summary band */}
        <div className="grid grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--gridline)] sm:grid-cols-3 lg:grid-cols-6">
          {/* Primary 1: Expected generation */}
          <div className="flex flex-col gap-0.5 p-3.5">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Expected generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(totalP50)}
            </div>
            <span className="text-11 text-ink-muted">
              P50 central estimate
            </span>
          </div>

          {/* Primary 2: Installed capacity */}
          <div className="flex flex-col gap-0.5 p-3.5">
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

          {/* Primary 3: Active risk events (Hero warning focus) */}
          <div className="flex flex-col gap-0.5 p-3.5 bg-[var(--page)]/30">
            <span className="text-11 font-semibold uppercase tracking-wider text-[var(--status-serious)]">
              Active risk events
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-20 font-semibold tabular-nums text-[var(--status-serious)]">
                {activeRiskSites.length} / {sites.length}
              </span>
              <span className="text-12 font-medium text-ink-secondary">sites</span>
            </div>
            <span className="text-11 font-semibold text-[var(--status-serious)]">
              {seriousOrCriticalCount} serious/critical
            </span>
          </div>

          {/* Secondary 1: Solar */}
          <div className="flex flex-col gap-0.5 p-3.5">
            <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wider text-ink-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: "#601D49" }} aria-hidden="true" />
              Solar generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(solarP50)}
            </div>
            <span className="text-11 text-ink-muted">
              {solarSites.length} sites · {mw(solarCapacity)}
            </span>
          </div>

          {/* Secondary 2: Wind */}
          <div className="flex flex-col gap-0.5 p-3.5">
            <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wider text-ink-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: "#BD5579" }} aria-hidden="true" />
              Wind generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(windP50)}
            </div>
            <span className="text-11 text-ink-muted">
              {windSites.length} sites · {mw(windCapacity)}
            </span>
          </div>

          {/* Secondary 3: Capacity factor */}
          <div className="flex flex-col gap-0.5 p-3.5">
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

      {/* ── 3. Primary Exception View: Sites Needing Attention (Top 3 default) ── */}
      <SitesNeedingAttention items={attentionSites} />

      {/* ── 4. Technology Mix (Compact) ────────────────────────────────────── */}
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

      {/* ── 5. Connected Assets (Clean Reference Registry) ─────────────────── */}
      <FleetTable sites={sites} fleet={fleet} siteRisks={siteRisks} />

      {/* ── 6. Operations Timing (Collapsed by default) ────────────────────── */}
      <OperationsTimingCollapsible
        currentBlock={curBlock}
        horizonBlock={horizBlock}
        actionableBlocks={actBlocks}
      >
        <BlockSpine />
      </OperationsTimingCollapsible>
    </div>
  );
}

/* ── Technology Mix (Compact) ─────────────────────────────────────────── */

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

  const SOLAR_COLOR = "#601D49";
  const WIND_COLOR = "#BD5579";

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="border-b border-[var(--gridline)] px-4 py-2.5">
        <h2 className="text-14 font-semibold text-ink-primary">Technology mix</h2>
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {/* Compact 2-item comparison row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded border border-[var(--gridline)] bg-[var(--page)]/30 px-3.5 py-2">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: SOLAR_COLOR }} aria-hidden="true" />
              <span className="text-13 font-semibold text-ink-primary">Solar PV</span>
            </div>
            <span className="text-12 tabular-nums text-ink-secondary">
              {solarSitesCount} sites · {mw(solarCapacity)} · {mwh(solarP50)}
            </span>
          </div>

          <div className="flex items-center justify-between rounded border border-[var(--gridline)] bg-[var(--page)]/30 px-3.5 py-2">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: WIND_COLOR }} aria-hidden="true" />
              <span className="text-13 font-semibold text-ink-primary">Wind</span>
            </div>
            <span className="text-12 tabular-nums text-ink-secondary">
              {windSitesCount} sites · {mw(windCapacity)} · {mwh(windP50)}
            </span>
          </div>
        </div>

        {/* Two restrained horizontal proportion bars */}
        <div className="flex flex-col gap-2.5 border-t border-[var(--gridline)] pt-2.5">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-11">
              <span className="font-medium text-ink-secondary">Installed capacity</span>
              <span className="tabular-nums text-ink-muted">
                Solar {solarCapPct.toFixed(1)}% | Wind {windCapPct.toFixed(1)}%
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

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-11">
              <span className="font-medium text-ink-secondary">Expected energy</span>
              <span className="tabular-nums text-ink-muted">
                Solar {solarGenPct.toFixed(1)}% | Wind {windGenPct.toFixed(1)}%
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
    </section>
  );
}

/* ── Main Fleet Table (Connected Assets Reference Registry) ───────────── */

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

  const ordered = [...sites].sort(
    (a, b) => (byId.get(b.id)?.mwh_p50 ?? -1) - (byId.get(a.id)?.mwh_p50 ?? -1),
  );

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-2.5">
        <h2 className="text-14 font-semibold text-ink-primary">Connected assets</h2>
        <span className="text-11 text-ink-muted">{sites.length} sites in portfolio</span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead>
            <tr className="border-b border-[var(--gridline)]">
              <Th>Site</Th>
              <Th>Technology</Th>
              <Th numeric>Capacity</Th>
              <Th numeric>Expected Energy</Th>
              <Th numeric>Peak Output</Th>
              <Th numeric>Capacity Factor</Th>
              <Th>Risk</Th>
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
                    <Td numeric>
                      <span className="font-medium tabular-nums">
                        {mwh(energy.mwh_p50)}
                      </span>
                      <div className="text-11 text-ink-muted">
                        {mwh(energy.mwh_p10)}–{mwh(energy.mwh_p90)}
                      </div>
                    </Td>
                  ) : (
                    <Td numeric muted>—</Td>
                  )}

                  {energy ? (
                    <Td numeric>
                      <span className="tabular-nums">{mw(energy.peak_mw)}</span>
                      <div className="text-11 text-ink-muted tabular-nums">
                        {blockStartLabel(energy.peak_block)}
                      </div>
                    </Td>
                  ) : (
                    <Td numeric muted>—</Td>
                  )}

                  {energy ? (
                    <Td numeric>{percent(energy.mean_capacity_factor)}</Td>
                  ) : (
                    <Td numeric muted>—</Td>
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
    </section>
  );
}
