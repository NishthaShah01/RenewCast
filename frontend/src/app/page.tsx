import Link from "next/link";

import { BlockSpine } from "@/components/BlockSpine";
import { Panel, ServiceDown, Stat, Td, Th } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { blockStartLabel } from "@/lib/blocks";
import { mw, mwh, percent, technologyLabel } from "@/lib/format";
import type { EnergySummary, HealthResponse, Site } from "@/lib/types";

/**
 * The fleet command centre.
 *
 * The question this page answers is "where do I need to look today?", so it is
 * ordered by that: the fleet's own numbers first, then a per-site table sorted
 * by how much energy each site is expected to put on the grid.
 *
 * It deliberately does not open with a hero figure in a coloured card. The
 * characteristic object in this product's world is the despatch day itself,
 * so the spine is the first thing on the page and everything below is read
 * against it.
 */
export default async function Home() {
    // Settled, not all: a health failure and a forecast failure are separate
    // problems, and the page should report whichever actually happened rather
    // than collapsing both into one blank screen.
    const [healthResult, sitesResult, fleetResult] = await Promise.allSettled([
        api.health(),
        api.sites(),
        api.fleetSummary(),
    ]);

    const health = healthResult.status === "fulfilled" ? healthResult.value : null;
    const sites = sitesResult.status === "fulfilled" ? sitesResult.value.sites : [];
    const fleet = fleetResult.status === "fulfilled" ? fleetResult.value : [];

    const failure =
        healthResult.status === "rejected"
            ? healthResult.reason
            : sitesResult.status === "rejected"
                ? sitesResult.reason
                : null;

    return (
        <div className="flex flex-col gap-8">
            <div>
                <h1 className="text-24 font-semibold tracking-[-0.01em]">Fleet</h1>
                <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">
                    Probabilistic generation forecasts for {sites.length} sites, aligned to
                    the 96-block despatch day.
                </p>
            </div>

            <BlockSpine />

            {failure ? <FailureNotice error={failure} /> : null}

            {fleet.length > 0 ? <FleetTotals fleet={fleet} /> : null}

            {sites.length > 0 ? <SiteTable sites={sites} fleet={fleet} /> : null}

            {health ? <ServiceStatus health={health} /> : null}
        </div>
    );
}

/* ── Fleet totals ───────────────────────────────────────────────────────── */

function FleetTotals({ fleet }: { fleet: EnergySummary[] }) {
    const p50 = fleet.reduce((s, r) => s + r.mwh_p50, 0);
    const p10 = fleet.reduce((s, r) => s + r.mwh_p10, 0);
    const p90 = fleet.reduce((s, r) => s + r.mwh_p90, 0);
    const capacity = fleet.reduce((s, r) => s + r.capacity_mw, 0);

    // Capacity-weighted, not a mean of means. A 2,245 MW site and a 250 MW site
    // do not contribute equally to how the fleet performed.
    const cf = capacity > 0 ? p50 / (capacity * 24) : 0;

    const solar = fleet.filter((r) => r.technology === "solar");
    const wind = fleet.filter((r) => r.technology === "wind");

    return (
        <Panel
            title="Today"
            meta={`${fleet.length} sites reporting`}
            footnote={
                <>
                    The fleet interval is the sum of the site intervals, which{" "}
                    <strong className="font-medium">overstates</strong> fleet uncertainty:
                    forecast errors at Bhadla and Muppandal are only partly correlated, so
                    in aggregate they partially cancel. Read it as a conservative bound,
                    not as a calibrated fleet interval.
                </>
            }
        >
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
                <Stat
                    label="Expected energy"
                    value={mwh(p50)}
                    note={`${mwh(p10)} to ${mwh(p90)} · 80% interval`}
                />
                <Stat
                    label="Capacity factor"
                    value={percent(cf)}
                    note={`${mw(capacity)} nameplate`}
                />
                <Stat
                    label="Solar"
                    value={mwh(solar.reduce((s, r) => s + r.mwh_p50, 0))}
                    note={`${solar.length} sites`}
                />
                <Stat
                    label="Wind"
                    value={mwh(wind.reduce((s, r) => s + r.mwh_p50, 0))}
                    note={`${wind.length} sites`}
                />
            </dl>
        </Panel>
    );
}

/* ── Site table ─────────────────────────────────────────────────────────── */

function SiteTable({ sites, fleet }: { sites: Site[]; fleet: EnergySummary[] }) {
    // Keyed on site_id, which is why identity travels in the summary payload:
    // the fleet endpoint omits sites whose forecast failed, so list position
    // would silently shift rows onto the wrong names.
    const byId = new Map(fleet.map((r) => [r.site_id, r]));
    const maxEnergy = Math.max(1, ...fleet.map((r) => r.mwh_p50));

    const ordered = [...sites].sort(
        (a, b) => (byId.get(b.id)?.mwh_p50 ?? -1) - (byId.get(a.id)?.mwh_p50 ?? -1),
    );

    return (
        <Panel
            title="Sites"
            meta={`${sites.length} configured`}
            footnote="Coordinates and nameplate capacity are public record. Evacuation limits and tariffs are indicative and configurable."
        >
            {/* Square corners: a rounded corner on a table cell fights the grid. */}
            <table className="w-full text-14">
                <thead>
                    <tr className="border-b border-[var(--gridline)]">
                        <Th>Site</Th>
                        <Th>Type</Th>
                        <Th numeric>Capacity</Th>
                        <Th numeric>Expected today</Th>
                        <Th width="180px">Relative</Th>
                        <Th numeric>Peak</Th>
                        <Th numeric>CF</Th>
                    </tr>
                </thead>
                <tbody>
                    {ordered.map((site) => {
                        const row = byId.get(site.id);
                        return (
                            <tr
                                key={site.id}
                                className="border-b border-[var(--gridline)] last:border-0"
                            >
                                <Td>
                                    <Link
                                        href={`/sites/${site.id}`}
                                        className="font-medium underline-offset-2 hover:underline"
                                    >
                                        {site.name}
                                    </Link>
                                    <span className="ml-2 text-11 text-ink-muted">{site.state}</span>
                                </Td>
                                <Td muted>{technologyLabel(site.technology)}</Td>
                                <Td numeric>{mw(site.capacity_mw)}</Td>

                                {row ? (
                                    <>
                                        <Td numeric>{mwh(row.mwh_p50)}</Td>
                                        <Td>
                                            <EnergyBar row={row} max={maxEnergy} />
                                        </Td>
                                        <Td numeric>
                                            {mw(row.peak_mw)}
                                            <span className="ml-1.5 text-11 text-ink-muted">
                                                {blockStartLabel(row.peak_block)}
                                            </span>
                                        </Td>
                                        <Td numeric>{percent(row.mean_capacity_factor)}</Td>
                                    </>
                                ) : (
                                    <Td className="text-ink-muted" numeric>
                                        <span className="text-12">No forecast</span>
                                    </Td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </Panel>
    );
}

/**
 * Energy with its interval, drawn in place.
 *
 * The bar is the P50 and the lighter extent behind it is P10–P90, so the
 * comparison between sites carries its own uncertainty rather than inviting
 * the reader to compare four point estimates as if they were exact.
 */
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

/* ── Service status ─────────────────────────────────────────────────────── */

function ServiceStatus({ health }: { health: HealthResponse }) {
    // 'degraded' is an honest state, not a failure: the server serves
    // physics-only forecasts without trained models, and saying so beats
    // implying the ML stage ran.
    const trained = health.models_loaded;

    return (
        <Panel title="Service" meta={`v${health.version}`}>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
                <Stat
                    label="Forecast model"
                    value={trained ? "Two-stage" : "Physics only"}
                    status={trained ? "good" : "warning"}
                    note={trained ? "Physics + gradient-boosted quantiles" : "No trained model on disk"}
                />
                <Stat
                    label="Copilot"
                    value={health.copilot_mode === "gemini" ? "Gemini" : "Deterministic"}
                    note={
                        health.copilot_mode === "gemini"
                            ? "Narration is model-generated"
                            : "No API key set — narration is rule-based"
                    }
                />
                <Stat
                    label="Server block"
                    value={String(health.current_block)}
                    note={`Revisable from ${health.revision_horizon_block}`}
                />
                <Stat
                    label="Clock"
                    value={health.server_time_ist.slice(11, 16)}
                    note="Server IST — the UI reconciles against this"
                />
            </dl>
        </Panel>
    );
}

/* ── Failure ────────────────────────────────────────────────────────────── */

function FailureNotice({ error }: { error: unknown }) {
    const message =
        error instanceof ApiError ? error.message : "The forecast service didn't respond.";
    const hint = error instanceof ApiError ? error.hint : undefined;
    return <ServiceDown message={message} hint={hint} />;
}
