import Link from "next/link";
import { BlockSpine } from "@/components/BlockSpine";
import { Panel, Stat, StatusDot, Td, Th, riskToStatus } from "@/components/ui";
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

  // Error condition: both or sites call failed
  if (sitesResult.status === "rejected") {
    const err = sitesResult.reason;
    const msg =
      err instanceof ApiError ? err.message : "Fleet data is unavailable.";
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-24 font-semibold tracking-[-0.01em]">Fleet</h1>
          <p className="mt-1 text-14 text-ink-secondary">
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
          <h1 className="text-24 font-semibold tracking-[-0.01em]">Fleet</h1>
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
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-24 font-semibold tracking-[-0.01em]">Fleet</h1>
        <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">
          Portfolio generation and operational status across {sites.length} connected renewable sites.
        </p>
      </div>

      {/* 96-block spine */}
      <BlockSpine />

      {/* Portfolio Summary Section */}
      <Panel
        title="Portfolio summary"
        meta={`${sites.length} sites (${solarSites.length} Solar · ${windSites.length} Wind)`}
        footnote={
          <>
            Fleet generation interval reflects conservative aggregate bounds (
            {mwh(totalP10)} to {mwh(totalP90)}). Plant schedules align with the
            96-block Indian CERC despatch grid.
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Installed capacity"
            value={mw(totalCapacity)}
            note={`${sites.length} total plants`}
          />
          <Stat
            label="Expected energy"
            value={mwh(totalP50)}
            note="P50 central estimate"
          />
          <Stat
            label="Solar generation"
            value={mwh(solarP50)}
            note={`${mw(solarCapacity)} (${((solarCapacity / totalCapacity) * 100).toFixed(0)}% cap)`}
          />
          <Stat
            label="Wind generation"
            value={mwh(windP50)}
            note={`${mw(windCapacity)} (${((windCapacity / totalCapacity) * 100).toFixed(0)}% cap)`}
          />
          <Stat
            label="Capacity factor"
            value={percent(fleetCf)}
            note="Fleet weighted average"
          />
          <Stat
            label="Active risk events"
            value={`${activeRiskSites.length} of ${sites.length}`}
            status={
              seriousOrCriticalCount > 0
                ? "serious"
                : activeRiskSites.length > 0
                  ? "warning"
                  : "good"
            }
            note={
              seriousOrCriticalCount > 0
                ? `${seriousOrCriticalCount} serious/critical`
                : activeRiskSites.length > 0
                  ? "Watch status"
                  : "All on plan"
            }
          />
        </dl>
      </Panel>

      {/* Technology Comparison */}
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

      {/* Sites Needing Attention (Ranked by Severity) */}
      <SitesNeedingAttention items={attentionSites} />

      {/* Main Fleet Table */}
      <FleetTable sites={sites} fleet={fleet} siteRisks={siteRisks} />
    </div>
  );
}

/* ── Technology Distribution Component ─────────────────────────────────── */

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

  // Calm, desaturated power-system operational colours
  const SOLAR_COLOR = "#B06B45";
  const WIND_COLOR = "#587A92";

  return (
    <Panel
      title="Technology distribution"
      meta="Solar vs Wind portfolio breakdown"
      footnote="Solar capacity is concentrated in Rajasthan, Karnataka, and Gujarat; wind capacity spans Tamil Nadu and Rajasthan."
    >
      <div className="flex flex-col gap-5 px-4 py-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {/* Installed Capacity Comparison */}
          <div className="flex flex-col gap-2.5">
            <div className="text-12 font-medium text-ink-primary">
              Installed capacity
            </div>

            {/* Solar Capacity Row */}
            <div className="flex items-center gap-3 text-12">
              <span className="w-12 shrink-0 font-medium text-ink-secondary">
                Solar
              </span>
              <span className="w-12 shrink-0 text-right font-medium tabular-nums text-ink-primary">
                {solarCapPct.toFixed(1)}%
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-[var(--gridline)]">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${solarCapPct}%`,
                    backgroundColor: SOLAR_COLOR,
                  }}
                />
              </div>
              <span className="min-w-[65px] shrink-0 text-right tabular-nums text-ink-muted">
                {mw(solarCapacity)}
              </span>
            </div>

            {/* Wind Capacity Row */}
            <div className="flex items-center gap-3 text-12">
              <span className="w-12 shrink-0 font-medium text-ink-secondary">
                Wind
              </span>
              <span className="w-12 shrink-0 text-right font-medium tabular-nums text-ink-primary">
                {windCapPct.toFixed(1)}%
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-[var(--gridline)]">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${windCapPct}%`,
                    backgroundColor: WIND_COLOR,
                  }}
                />
              </div>
              <span className="min-w-[65px] shrink-0 text-right tabular-nums text-ink-muted">
                {mw(windCapacity)}
              </span>
            </div>
          </div>

          {/* Expected Energy Comparison */}
          <div className="flex flex-col gap-2.5">
            <div className="text-12 font-medium text-ink-primary">
              Expected energy (P50)
            </div>

            {/* Solar Energy Row */}
            <div className="flex items-center gap-3 text-12">
              <span className="w-12 shrink-0 font-medium text-ink-secondary">
                Solar
              </span>
              <span className="w-12 shrink-0 text-right font-medium tabular-nums text-ink-primary">
                {solarGenPct.toFixed(1)}%
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-[var(--gridline)]">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${solarGenPct}%`,
                    backgroundColor: SOLAR_COLOR,
                  }}
                />
              </div>
              <span className="min-w-[65px] shrink-0 text-right tabular-nums text-ink-muted">
                {mwh(solarP50)}
              </span>
            </div>

            {/* Wind Energy Row */}
            <div className="flex items-center gap-3 text-12">
              <span className="w-12 shrink-0 font-medium text-ink-secondary">
                Wind
              </span>
              <span className="w-12 shrink-0 text-right font-medium tabular-nums text-ink-primary">
                {windGenPct.toFixed(1)}%
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-[var(--gridline)]">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${windGenPct}%`,
                    backgroundColor: WIND_COLOR,
                  }}
                />
              </div>
              <span className="min-w-[65px] shrink-0 text-right tabular-nums text-ink-muted">
                {mwh(windP50)}
              </span>
            </div>
          </div>
        </div>

        {/* Quiet Legend */}
        <div className="flex flex-wrap items-center gap-6 border-t border-[var(--gridline)] pt-3 text-12">
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: SOLAR_COLOR }}
              aria-hidden="true"
            />
            <span className="font-medium text-ink-primary">Solar PV</span>
            <span className="text-11 text-ink-muted">
              {solarSitesCount} sites · {mw(solarCapacity)} · {mwh(solarP50)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: WIND_COLOR }}
              aria-hidden="true"
            />
            <span className="font-medium text-ink-primary">Wind</span>
            <span className="text-11 text-ink-muted">
              {windSitesCount} sites · {mw(windCapacity)} · {mwh(windP50)}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ── Sites Needing Attention ───────────────────────────────────────────── */

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
      <Panel title="Sites needing attention" meta="0 sites at risk">
        <p className="px-4 py-5 text-13 text-ink-secondary">
          All sites are operating within standard declared schedule parameters.
          No high-severity operational deviations detected.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Sites needing attention"
      meta={`${items.length} of 5 flagged`}
      footnote="Ranked by operational severity (0–100). Surfaces sites with active Watch, Serious, or Critical events."
    >
      <div className="divide-y divide-[var(--gridline)]">
        {items.map(({ site, risk }) => {
          if (!risk) return null;
          const statusLevel = riskToStatus(risk.riskLevel);
          return (
            <div
              key={site.id}
              className="flex flex-col gap-3 p-4 transition-colors hover:bg-[var(--page)]/40 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1 sm:max-w-[70%]">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/sites/${site.id}`}
                    className="font-semibold text-ink-primary hover:underline"
                  >
                    {site.name}
                  </Link>
                  <span className="text-11 text-ink-muted">({site.state})</span>
                  <span className="text-11 text-ink-muted">·</span>
                  <span
                    className="inline-flex items-center gap-1.5 text-12 font-medium capitalize"
                    style={{ color: `var(--status-${statusLevel})` }}
                  >
                    <StatusDot level={statusLevel} />
                    {RISK_LABELS[risk.riskLevel] ?? risk.riskLevel} (severity {risk.severity})
                  </span>
                </div>

                {risk.driver && (
                  <p className="text-13 text-ink-secondary">
                    <strong className="font-medium text-ink-primary">Main event: </strong>
                    {risk.topEventTitle ? `${risk.topEventTitle} — ` : ""}
                    {risk.driver}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3 text-11 text-ink-muted">
                  {risk.peakDeviationMw !== undefined && (
                    <span>
                      Peak deviation:{" "}
                      <strong className="font-semibold tabular-nums text-ink-primary">
                        {mw(risk.peakDeviationMw)}
                      </strong>
                    </span>
                  )}
                  {risk.recommendedAction && (
                    <>
                      <span>·</span>
                      <span>
                        Action:{" "}
                        <strong className="font-medium text-ink-primary">
                          {risk.recommendedAction}
                        </strong>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-center">
                <Link
                  href={`/sites/${site.id}/decisions`}
                  className="rounded border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-primary hover:bg-[var(--page)]"
                >
                  Despatch Plan →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ── Main Fleet Table ─────────────────────────────────────────────────── */

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
        <table className="w-full text-14">
          <thead>
            <tr className="border-b border-[var(--gridline)]">
              <Th>Site</Th>
              <Th>Technology</Th>
              <Th numeric>Capacity</Th>
              <Th numeric>Expected Energy</Th>
              <Th width="160px">Relative</Th>
              <Th numeric>Peak Output</Th>
              <Th numeric>Capacity Factor</Th>
              <Th>Risk / Status</Th>
              <Th>Recommended Action</Th>
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
                          background: isSolar ? "#C78A00" : "#4F82B8",
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
                    {risk?.recommendedAction ? (
                      <span className="text-12 font-medium text-ink-secondary">
                        {risk.recommendedAction}
                      </span>
                    ) : (
                      <span className="text-12 text-ink-muted">On plan</span>
                    )}
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
