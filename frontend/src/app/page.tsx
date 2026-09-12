import Link from "next/link";

import { MotionSection } from "@/components/MotionSection";
import { ServiceDown, StatusDot, riskToStatus } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { blockLabel, blockOf, revisionHorizonBlock } from "@/lib/blocks";
import { ACTION_LABELS, RISK_LABELS, mw, mwh, technologyLabel } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";

export const metadata = {
  title: "Command Centre — RenewCast",
  description:
    "RenewCast Command Centre: Probabilistic 72-hour renewable generation forecasting and despatch decision engine for the Indian grid.",
};

const KNOWN_SITE_IDS = ["pavagada", "bhadla", "muppandal", "jaisalmer", "charanka"];

/**
 * RenewCast Command Centre — Root Route (/)
 *
 * The primary operations entry point. Answers within seconds:
 * What is happening? Where? How serious? What should I do?
 */
export default async function Home() {
  // Concurrently fetch all foundational resources and site decisions in parallel
  const [healthResult, sitesResult, fleetResult, ...knownDecisionsResults] =
    await Promise.allSettled([
      api.health(),
      api.sites(),
      api.fleetSummary(),
      ...KNOWN_SITE_IDS.map((id) => api.decisions(id, 24)),
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

  if (failure) {
    return (
      <ServiceDown
        title="Command Centre unavailable"
        message={failure instanceof ApiError ? failure.message : "The service didn't respond."}
        hint={failure instanceof ApiError ? failure.hint : undefined}
      />
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

  let topRisk: {
    site: (typeof sites)[0];
    severity: number;
    riskLevel: RiskLevel;
    eventLabel?: string;
    eventType?: string;
    peakDeviationMw?: number;
    driver?: string;
    recommendedAction?: string;
  } | null = null;

  for (let i = 0; i < sites.length; i++) {
    const d = decisionsMap.get(sites[i].id);
    if (d) {
      const topEvent = d.events && d.events.length > 0 ? d.events[0] : null;
      const topAction = d.actions && d.actions.length > 0 ? d.actions[0] : null;
      const worstBlock = d.blocks?.reduce(
        (max: any, b: any) => ((b.severity ?? 0) > (max.severity ?? 0) ? b : max),
        d.blocks[0],
      );
      const sev = topEvent ? topEvent.severity : (worstBlock?.severity ?? 0);
      const lvl = topEvent ? topEvent.risk_level : (worstBlock?.risk ?? "good");

      if (sev >= 25 && (!topRisk || sev > topRisk.severity)) {
        const actionName = topAction ? (ACTION_LABELS[topAction.action] ?? topAction.action) : null;
        const actionTime = topAction?.label ? ` (${topAction.label})` : "";
        const actionStr = topAction && actionName ? `${actionName}: ${mw(topAction.magnitude_mw)}${actionTime}` : undefined;

        topRisk = {
          site: sites[i],
          severity: sev,
          riskLevel: lvl,
          eventLabel: topEvent?.label,
          eventType: topEvent?.event_type,
          peakDeviationMw: topEvent?.peak_deviation_mw ?? (worstBlock ? Math.abs(worstBlock.deviation_mw) : undefined),
          driver: topEvent?.driver ?? worstBlock?.driver ?? undefined,
          recommendedAction: actionStr ?? topEvent?.recommended_action ?? undefined,
        };
      }
    }
  }

  const totalCapacity = sites.reduce((sum, s) => sum + s.capacity_mw, 0);
  const totalP50 = fleet.reduce((sum, r) => sum + r.mwh_p50, 0);
  const totalP10 = fleet.reduce((sum, r) => sum + r.mwh_p10, 0);
  const totalP90 = fleet.reduce((sum, r) => sum + r.mwh_p90, 0);

  const now = new Date();
  const currentBlock = health?.current_block ?? blockOf(now);
  const horizonBlock = health?.revision_horizon_block ?? revisionHorizonBlock(now);
  const actionableBlocks = Math.max(0, 96 - horizonBlock + 1);

  return (
    <div className="flex flex-col gap-6">
      {/* ── 1. Command Centre Header ────────────────────────────────────────── */}
      <MotionSection as="header" index={0} className="border-b border-[var(--gridline)] pb-3">
        <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary sm:text-22">
          Command Centre
        </h1>
        <p className="mt-0.5 max-w-[76ch] text-12 text-ink-secondary leading-relaxed">
          72-hour generation forecast & despatch decision engine for the Indian grid · 96 blocks
        </p>
      </MotionSection>

      {/* ── 2. Primary Operational Exception (What is happening? Where? How serious? What to do?) ── */}
      {topRisk ? (
        <MotionSection
          as="section"
          index={1}
          className="rounded-panel border bg-surface p-3.5 sm:p-4"
          style={{
            borderColor: `color-mix(in srgb, var(--status-${riskToStatus(topRisk.riskLevel)}) 40%, var(--ring))`,
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-11 font-semibold uppercase tracking-wider"
                  style={{
                    backgroundColor: `color-mix(in srgb, var(--status-${riskToStatus(topRisk.riskLevel)}) 12%, transparent)`,
                    color: `var(--status-${riskToStatus(topRisk.riskLevel)})`,
                    border: `1px solid color-mix(in srgb, var(--status-${riskToStatus(topRisk.riskLevel)}) 25%, transparent)`,
                  }}
                >
                  <StatusDot level={riskToStatus(topRisk.riskLevel)} />
                  {RISK_LABELS[topRisk.riskLevel] ?? topRisk.riskLevel} {topRisk.severity}
                </span>
                <span className="text-14 font-semibold text-ink-primary">
                  {topRisk.site.name}
                </span>
                <span className="text-11 text-ink-muted">({topRisk.site.state})</span>
                <span className="text-11 text-ink-muted">·</span>
                <span className="text-12 font-medium text-ink-secondary tabular-nums">
                  {topRisk.eventLabel} {topRisk.eventType && `· ${topRisk.eventType}`} {topRisk.peakDeviationMw !== undefined && `· +${mw(topRisk.peakDeviationMw)} deviation`}
                </span>
              </div>
              {topRisk.driver && (
                <p className="text-12 text-ink-secondary">
                  <span className="text-ink-muted">Driver:</span> {topRisk.driver}
                </p>
              )}
              {topRisk.recommendedAction && (
                <p className="text-12 font-medium text-ink-primary">
                  <span className="text-ink-muted font-normal">Recommended action:</span> {topRisk.recommendedAction}
                </p>
              )}
            </div>

            <Link
              href={`/sites/${topRisk.site.id}/decisions`}
              className="rounded-control bg-[var(--ink-primary)] px-3 py-1.5 text-12 font-medium text-[var(--surface)] hover:opacity-90 active:scale-[0.98] self-start sm:self-center shrink-0 whitespace-nowrap transition-all duration-150 inline-flex items-center gap-1"
            >
              <span>Review despatch plan</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </MotionSection>
      ) : (
        <MotionSection
          as="section"
          index={1}
          className="rounded-panel border border-[var(--gridline)] bg-surface px-4 py-3 flex items-center gap-2.5"
        >
          <StatusDot level="good" />
          <span className="text-13 font-semibold text-ink-primary">
            Normal Grid Operations
          </span>
          <span className="text-12 text-ink-secondary">
            — All {sites.length} sites operating within declared schedule parameters.
          </span>
        </MotionSection>
      )}

      {/* ── 3. Grid Posture Strip ──────────────────────────────────────────── */}
      <MotionSection as="section" index={2} className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gridline)] px-4 py-2">
          <h2 className="text-14 font-semibold text-ink-primary">Grid posture</h2>
          <Link
            href="/fleet"
            className="btn-secondary text-11"
          >
            Open Portfolio →
          </Link>
        </header>

        <div className="grid grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--gridline)] sm:grid-cols-4">
          <div className="flex flex-col gap-0.5 p-3.5">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Monitored capacity
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mw(totalCapacity)}
            </div>
            <span className="text-11 text-ink-muted">
              {sites.length} utility-scale assets
            </span>
          </div>

          <div className="flex flex-col gap-0.5 p-3.5">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Expected generation
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {mwh(totalP50)}
            </div>
            <span className="text-11 text-ink-muted tabular-nums">
              P10 {mwh(totalP10)} · P90 {mwh(totalP90)}
            </span>
          </div>

          <div className="flex flex-col gap-0.5 p-3.5">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Revision gate
            </span>
            <div className="text-20 font-semibold tabular-nums text-ink-primary">
              {actionableBlocks} blocks
            </div>
            <span className="text-11 text-ink-muted">
              Actionable today (from block {horizonBlock})
            </span>
          </div>

          <div className="flex flex-col gap-0.5 p-3.5 bg-[var(--page)]/30">
            <span className="text-11 font-medium uppercase tracking-wider text-ink-muted">
              Despatch engine
            </span>
            <div className="flex items-center gap-2">
              <StatusDot level={health?.models_loaded ? "good" : "warning"} />
              <span className="text-13 font-semibold text-ink-primary">
                {health?.models_loaded ? "Two-Stage Active" : "Physics Only"}
              </span>
            </div>
            <span className="text-11 text-ink-muted">
              Copilot: {health?.copilot_mode === "gemini" ? "Gemini AI" : "Deterministic"}
            </span>
          </div>
        </div>
      </MotionSection>

      {/* ── 4. Operations & Modules ────────────────────────────────────────── */}
      <MotionSection as="section" index={3}>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-14 font-semibold text-ink-primary">Operations & modules</h2>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <ModuleCard
            href="/fleet"
            title="Portfolio"
            tag="Portfolio Operations"
            description="Overview of all 5 generating assets, real-time exception triage ranked by severity, and solar vs wind technology mix."
            cta="Open Portfolio →"
          />

          <ModuleCard
            href="/accuracy"
            title="Accuracy"
            tag="Model Governance"
            description="Evaluation against archived forecast weather at 4 lead times. 6.39% solar & 6.81% wind skill over pure physics baselines."
            cta="View Accuracy →"
          />

          <ModuleCard
            href="/simulator"
            title="Simulator"
            tag="Scenario Modeling"
            description="Test battery flexibility, peaker dispatch, and curtailment actions under dynamic grid evacuation limits."
            cta="Launch Simulator →"
          />

          <ModuleCard
            href="/ingest"
            title="Historical Data"
            tag="CERC Compliance"
            description="Reconcile metered plant generation telemetry against declared schedules for Deviation Settlement Mechanism (DSM)."
            cta="Import Historical Data →"
          />
        </div>
      </MotionSection>

      {/* ── 5. Connected Assets Direct Launch ──────────────────────────────── */}
      <MotionSection as="section" index={4} className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-14 font-semibold text-ink-primary">Connected assets</h2>
            <span className="rounded-full bg-[var(--page)] px-2 py-0.5 text-11 font-medium text-ink-muted">
              {sites.length} sites online
            </span>
          </div>
          <span className="text-11 text-ink-muted">
            72-hour forecasts & 96-block despatch plans
          </span>
        </header>

        <div className="divide-y divide-[var(--gridline)]">
          {sites.map((site) => {
            const siteEnergy = fleet.find((f) => f.site_id === site.id);
            return (
              <div
                key={site.id}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-[var(--page)]/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/sites/${site.id}`}
                      className="text-14 font-semibold text-ink-primary hover:text-[var(--series-1)] hover:underline"
                    >
                      {site.name}
                    </Link>
                    <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-11 font-medium text-ink-muted">
                      {technologyLabel(site.technology)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-12 text-ink-secondary">
                    {site.state} · Commissioned {site.commissioned_year} · Evacuation limit: {mw(site.evacuation_limit_mw)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  <div className="text-right">
                    <div className="text-13 font-semibold tabular-nums text-ink-primary">
                      {mw(site.capacity_mw)}
                    </div>
                    <div className="text-11 text-ink-muted tabular-nums">
                      {siteEnergy ? `${mwh(siteEnergy.mwh_p50)} P50` : "Capacity"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/sites/${site.id}`}
                      className="btn-secondary text-11"
                    >
                      Forecast
                    </Link>
                    <Link
                      href={`/sites/${site.id}/decisions`}
                      className="btn-primary text-11"
                    >
                      Despatch plan
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </MotionSection>

      {/* ── 6. System Architecture & CERC Framework ────────────────────────── */}
      <MotionSection as="section" index={5} className="rounded-panel border border-[var(--ring)] bg-surface p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
              Two-Stage Architecture
            </span>
            <p className="mt-1 text-12 text-ink-secondary leading-relaxed">
              Stage A deterministic physics baseline (solar geometry & turbine curves) combined with
              Stage B LightGBM quantile regression. No target lags; verified zero data leak.
            </p>
          </div>

          <div>
            <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
              CERC 96-Block Despatch
            </span>
            <p className="mt-1 text-12 text-ink-secondary leading-relaxed">
              Voluntary schedule revisions take effect from the 6th block ahead (90 minutes);
              RLDC revisions take effect from the 4th block. Locked blocks are strictly respected.
            </p>
          </div>

          <div>
            <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
              P10 / P50 / P90 Asymmetry
            </span>
            <p className="mt-1 text-12 text-ink-secondary leading-relaxed">
              Shortfall risk is evaluated against the P10 floor, surplus and curtailment against the P90 ceiling,
              and energy accounting against P50. Quantiles are never interchanged.
            </p>
          </div>
        </div>
      </MotionSection>
    </div>
  );
}

/* ── Helper Components ────────────────────────────────────────────────────── */

function ModuleCard({
  href,
  title,
  tag,
  description,
  cta,
}: {
  href: string;
  title: string;
  tag: string;
  description: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between rounded-panel border border-[var(--ring)] bg-surface p-4 transition-all duration-150 hover:border-[var(--series-1)]/40 hover:shadow-xs active:scale-[0.99]"
    >
      <div>
        <span className="text-10 font-semibold uppercase tracking-wider text-ink-muted">
          {tag}
        </span>
        <h3 className="mt-1 text-15 font-semibold text-ink-primary group-hover:text-[var(--series-1)]">
          {title}
        </h3>
        <p className="mt-1.5 text-12 text-ink-secondary leading-relaxed">
          {description}
        </p>
      </div>

      <div className="mt-4 pt-2 border-t border-[var(--gridline)] flex items-center justify-between">
        <span className="btn-secondary text-11 group-hover:border-[var(--series-1)]/60">
          {cta}
        </span>
      </div>
    </Link>
  );
}
