import Link from "next/link";
import { BlockSpine } from "@/components/BlockSpine";
import { MotionSection } from "@/components/MotionSection";
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
  title: "Portfolio — RenewCast",
  description:
    "Overview of connected solar and wind generation assets, portfolio totals, and active operational risk events.",
};

const KNOWN_SITE_IDS = ["pavagada", "bhadla", "muppandal", "jaisalmer", "charanka"];

export default async function FleetPage() {
  const [sitesResult, fleetResult, ...knownDecisionsResults] = await Promise.allSettled([
    api.sites(),
    api.fleetSummary(),
    ...KNOWN_SITE_IDS.map((id) => api.decisions(id, 24)),
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
          <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">Portfolio</h1>
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

  // Map known decisions results by site id
  const decisionsMap = new Map<string, any>();
  for (let i = 0; i < KNOWN_SITE_IDS.length; i++) {
    const res = knownDecisionsResults[i];
    if (res && res.status === "fulfilled") {
      decisionsMap.set(KNOWN_SITE_IDS[i], res.value);
    }
  }

  const siteRisks = new Map<string, SiteRiskInfo>();
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const d = decisionsMap.get(s.id);
    if (d) {
      const topEvent = d.events && d.events.length > 0 ? d.events[0] : null;
      const topAction = d.actions && d.actions.length > 0 ? d.actions[0] : null;

      const worstBlock = d.blocks?.reduce(
        (max: any, b: any) => ((b.severity ?? 0) > (max.severity ?? 0) ? b : max),
        d.blocks[0],
      );

      const severity = topEvent ? topEvent.severity : (worstBlock?.severity ?? 0);
      const riskLevel = topEvent ? topEvent.risk_level : (worstBlock?.risk ?? "good");

      const actionName = topAction ? (ACTION_LABELS[topAction.action] ?? topAction.action) : null;
      const actionTime = topAction?.label ? ` (${topAction.label})` : "";
      const actionStr =
        topAction && actionName
          ? `${actionName}: ${mw(topAction.magnitude_mw)}${actionTime}`
          : undefined;

      siteRisks.set(s.id, {
        siteId: s.id,
        riskLevel,
        severity,
        eventLabel: topEvent?.label,
        eventType: topEvent?.event_type,
        driver: topEvent?.driver ?? (worstBlock?.driver ?? undefined),
        peakDeviationMw:
          topEvent?.peak_deviation_mw ??
          (worstBlock ? Math.abs(worstBlock.deviation_mw) : undefined),
        recommendedAction: actionStr ?? (topEvent?.recommended_action ?? undefined),
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
    <div className="flex flex-col gap-4">
      {/* ── 1. Portfolio Header ────────────────────────────────────── */}
      <MotionSection as="header" index={0} className="border-b border-[var(--gridline)] pb-2.5">
        <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">Portfolio</h1>
        <p className="mt-0.5 text-12 font-medium tabular-nums text-ink-secondary">
          {sites.length} sites · {mw(totalCapacity)}
        </p>
      </MotionSection>

      {/* ── 2. Portfolio status (One compact operational strip) ─────────────── */}
      <MotionSection as="section" index={1} className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="border-b border-[var(--gridline)] px-4 py-2">
          <h2 className="text-14 font-semibold text-ink-primary">Portfolio status</h2>
        </header>

        {/* Compact horizontal operational summary band */}
        <div className="grid grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--gridline)] sm:grid-cols-3 lg:grid-cols-6">
          {/* Expected generation */}
          <div className="flex flex-col gap-0.5 p-3">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Expected generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(totalP50)}
            </div>
          </div>

          {/* Installed capacity */}
          <div className="flex flex-col gap-0.5 p-3">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Installed capacity
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mw(totalCapacity)}
            </div>
          </div>

          {/* Active risk events */}
          <div className="flex flex-col gap-0.5 p-3 bg-[var(--page)]/30">
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

          {/* Solar generation */}
          <div className="flex flex-col gap-0.5 p-3">
            <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wider text-ink-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: "#601D49" }} aria-hidden="true" />
              Solar generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(solarP50)}
            </div>
          </div>

          {/* Wind generation */}
          <div className="flex flex-col gap-0.5 p-3">
            <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-wider text-ink-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: "#BD5579" }} aria-hidden="true" />
              Wind generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(windP50)}
            </div>
          </div>

          {/* Capacity factor */}
          <div className="flex flex-col gap-0.5 p-3">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Capacity factor
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {percent(fleetCf)}
            </div>
          </div>
        </div>
      </MotionSection>

      {/* ── 3. Primary Exception View: Sites Needing Attention (Top 3 default) ── */}
      <MotionSection as="div" index={2}>
        <SitesNeedingAttention items={attentionSites} />
      </MotionSection>

      {/* ── 4. Technology Mix (Compact) ────────────────────────────────────── */}
      <MotionSection as="div" index={3}>
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
      </MotionSection>

      {/* ── 5. Connected Assets (Clean Reference Registry) ─────────────────── */}
      <MotionSection as="div" index={4}>
        <FleetTable sites={sites} fleet={fleet} siteRisks={siteRisks} />
      </MotionSection>

      {/* ── 6. Operations Timing (Collapsed by default) ────────────────────── */}
      <MotionSection as="div" index={5}>
        <OperationsTimingCollapsible
          currentBlock={curBlock}
          horizonBlock={horizBlock}
          actionableBlocks={actBlocks}
        >
          <BlockSpine />
        </OperationsTimingCollapsible>
      </MotionSection>
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
      <header className="border-b border-[var(--gridline)] px-4 py-2">
        <h2 className="text-14 font-semibold text-ink-primary">Technology mix</h2>
      </header>

      <div className="flex flex-col gap-3 p-3.5">
        {/* Compact 2-item comparison row */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded border border-[var(--gridline)] bg-[var(--page)]/30 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: SOLAR_COLOR }} aria-hidden="true" />
              <span className="text-13 font-semibold text-ink-primary">Solar PV</span>
            </div>
            <span className="text-12 tabular-nums text-ink-secondary">
              {solarSitesCount} sites · {mw(solarCapacity)} · {mwh(solarP50)}
            </span>
          </div>

          <div className="flex items-center justify-between rounded border border-[var(--gridline)] bg-[var(--page)]/30 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: WIND_COLOR }} aria-hidden="true" />
              <span className="text-13 font-semibold text-ink-primary">Wind</span>
            </div>
            <span className="text-12 tabular-nums text-ink-secondary">
              {windSitesCount} sites · {mw(windCapacity)} · {mwh(windP50)}
            </span>
          </div>
        </div>

        {/* Two restrained horizontal proportion bars */}
        <div className="flex flex-col gap-2 border-t border-[var(--gridline)] pt-2">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-11">
              <span className="font-medium text-ink-secondary">Installed capacity</span>
              <span className="tabular-nums text-ink-muted">
                Solar {solarCapPct.toFixed(1)}% | Wind {windCapPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-[var(--gridline)]">
              <div
                className="h-full rounded-l-sm transition-[width] duration-500 ease-out"
                style={{ width: `${solarCapPct}%`, backgroundColor: SOLAR_COLOR }}
                title={`Solar: ${solarCapPct.toFixed(1)}%`}
              />
              <div
                className="h-full rounded-r-sm transition-[width] duration-500 ease-out"
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
            <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-[var(--gridline)]">
              <div
                className="h-full rounded-l-sm transition-[width] duration-500 ease-out"
                style={{ width: `${solarGenPct}%`, backgroundColor: SOLAR_COLOR }}
                title={`Solar: ${solarGenPct.toFixed(1)}%`}
              />
              <div
                className="h-full rounded-r-sm transition-[width] duration-500 ease-out"
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
      <header className="border-b border-[var(--gridline)] px-4 py-2">
        <h2 className="text-14 font-semibold text-ink-primary">Connected assets</h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead>
            <tr className="border-b border-[var(--gridline)]">
              <Th>Site</Th>
              <Th>Technology</Th>
              <Th numeric>Capacity</Th>
              <Th numeric>Expected energy</Th>
              <Th numeric>Peak</Th>
              <Th numeric>Capacity factor</Th>
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
                      className="btn-secondary"
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
