import Link from "next/link";
import { notFound } from "next/navigation";

import { ForecastExplorer } from "@/components/ForecastExplorer";
import { HorizonSelector } from "@/components/HorizonSelector";
import { Caveat, Panel, ServiceDown, Stat } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { blockStartLabel } from "@/lib/blocks";
import { splitDays } from "@/lib/days";
import {
  ACTION_LABELS,
  issuedAtLabel,
  mw,
  mwh,
  percent,
  technologyLabel,
} from "@/lib/format";
import { HORIZON_PARAM, parseHorizon } from "@/lib/horizon";
import type { DecisionResponse, ForecastResponse, Site } from "@/lib/types";

/**
 * One site, one despatch day at a time.
 *
 * The page is built around a single question — what will this plant put on the
 * grid, and how sure are we — so the fan chart is the whole top of the page
 * and everything else is subordinate to reading it: the day's energy beneath
 * it, the plant's physical configuration below that.
 *
 * The horizon decides how many days the forecast covers; the day selector
 * inside the panel decides which one is on screen. Both live in the same
 * surface because they answer one question in two steps — how far ahead, then
 * which day — and neither is useful without the other.
 *
 * The declared schedule is overlaid from the decisions endpoint rather than
 * fetched separately, because the two must agree. A schedule drawn from one
 * request and deviations computed from another would eventually disagree by a
 * block and nobody would notice.
 *
 * The horizon selector governs the forecast request only. The despatch plan is
 * a document about one despatch day whatever the forecast window is, so its
 * request stays at 24 h — see `lib/horizon.ts`.
 */
export default async function SitePage(props: PageProps<"/sites/[siteId]">) {
  const { siteId } = await props.params;
  const horizon = parseHorizon((await props.searchParams)[HORIZON_PARAM]);

  const [forecastResult, decisionsResult] = await Promise.allSettled([
    api.forecast(siteId, horizon),
    api.decisions(siteId, 24),
  ]);

  if (
    forecastResult.status === "rejected" &&
    forecastResult.reason instanceof ApiError &&
    forecastResult.reason.status === 404
  ) {
    notFound();
  }

  if (forecastResult.status === "rejected") {
    const error = forecastResult.reason;
    return (
      <ServiceDown
        title="Forecast unavailable"
        message={
          error instanceof ApiError ? error.message : "The forecast service didn't respond."
        }
        hint={error instanceof ApiError ? error.hint : undefined}
      />
    );
  }

  const forecast = forecastResult.value;
  const decisions = decisionsResult.status === "fulfilled" ? decisionsResult.value : null;
  const site = forecast.site;

  // The forecast window opens at block 1 of today and runs forward from now,
  // so it always ends mid-day. `splitDays` hands back the whole despatch days
  // the horizon entitles this response to — one at 24 h, three at 72 h — and
  // leaves the partial tail out of the day selector.
  const days = splitDays(forecast.blocks, forecast.despatch_date, horizon);

  // A response with no whole day in it cannot be plotted on a 96-block spine.
  // Saying so beats every downstream reduce failing on an empty array.
  if (days.length === 0) {
    return (
      <ServiceDown
        title="Forecast incomplete"
        message="The forecast service returned no complete despatch day for this site."
        hint="Try again once the next forecast run has published."
      />
    );
  }

  const today = days[0].blocks;

  const schedule = decisions
    ? decisions.blocks.map((b) => [b.block, b.schedule_mw] as [number, number])
    : undefined;

  const energyP50 = today.reduce((s, b) => s + b.p50, 0) / 4;
  const energyP10 = today.reduce((s, b) => s + b.p10, 0) / 4;
  const energyP90 = today.reduce((s, b) => s + b.p90, 0) / 4;
  const peak = today.reduce((a, b) => (b.p50 > a.p50 ? b : a), today[0]);

  // Where the model is least sure. Worth naming explicitly — it is the block
  // an operator should hold reserve against, and it is rarely the peak.
  const widest = today.reduce(
    (a, b) => (b.p90 - b.p10 > a.p90 - a.p10 ? b : a),
    today[0],
  );

  return (
    <div className="flex flex-col gap-8">
      <SiteHeader site={site} forecast={forecast} />

      {/* Primary Operational Decision Callout */}
      {decisions ? <DecisionsSummary decisions={decisions} siteId={site.id} /> : null}

      <Panel
        title="Forecast"
        action={<HorizonSelector value={horizon} />}
        footnote={
          // The window figure is the backend's own `horizon_hours` echo and the
          // length of the block list it returned — not a frontend calculation.
          // Saying how many whole days that buys is the difference between a
          // control that looks broken at 48 h and one whose scope is understood.
          `Window: ${forecast.horizon_hours} h from issue, ${forecast.blocks.length} blocks returned — ` +
          `${days.length === 1 ? "one whole despatch day" : `${days.length} whole despatch days`}. ` +
          `Each day is plotted on the same 96-block spine; the window's partial tail ` +
          `extends the forecast, not the spine. Now, the revision gate and the declared ` +
          `schedule belong to the current day only. ` +
          `The despatch plan below covers one despatch day at every horizon.`
        }
      >
        <ForecastExplorer
          days={days}
          site={site}
          schedule={schedule}
          currentBlock={forecast.current_block}
          revisionHorizonBlock={forecast.revision_horizon_block}
        />

        {(forecast.degraded || forecast.notes.length > 0 || decisions) && (
          <div className="flex flex-col gap-2 border-t border-[var(--gridline)] px-4 py-3">
            {forecast.degraded ? (
              <Caveat>
                Physics only — no trained model was loaded, so these are Stage A
                numbers with a nominal spread rather than learned quantiles.
              </Caveat>
            ) : null}
            {forecast.notes.map((note) => (
              <Caveat key={note}>{note}</Caveat>
            ))}
            {decisions ? (
              <Caveat>{decisions.schedule_basis}</Caveat>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel
        title="Today"
        meta={`issued ${issuedAtLabel(forecast.issued_at)}`}
        footnote={`Energy is the block-integrated median: each block is a quarter hour, so MWh is MW ÷ 4. Weather from ${forecast.weather_source}, model ${forecast.model_version}.`}
      >
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
          <Stat
            label="Expected energy"
            value={mwh(energyP50)}
            note={`${mwh(energyP10)} to ${mwh(energyP90)} · 80% interval`}
          />
          <Stat
            label="Peak"
            value={mw(peak.p50)}
            note={`${peak.label} · block ${peak.block}`}
          />
          <Stat
            label="Capacity factor"
            value={percent(energyP50 / (site.capacity_mw * 24))}
            note={`${mw(site.capacity_mw)} nameplate`}
          />
          <Stat
            label="Least certain block"
            value={`±${mw((widest.p90 - widest.p10) / 2)}`}
            note={`${blockStartLabel(widest.block)} · hold reserve here`}
          />
        </dl>
      </Panel>

      <PlantConfiguration site={site} />
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function SiteHeader({ site, forecast }: { site: Site; forecast: ForecastResponse }) {
  return (
    <div>
      <nav className="mb-2 text-11 text-ink-muted">
        <Link href="/" className="underline-offset-2 hover:underline">
          Fleet
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>{site.name}</span>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="text-24 font-semibold tracking-[-0.01em]">{site.name}</h1>
        <p className="text-12 text-ink-secondary tabular-nums">
          {technologyLabel(site.technology)} · {mw(site.capacity_mw)} · {site.state} ·
          commissioned {site.commissioned_year}
        </p>
      </div>

      <p className="mt-1 max-w-[72ch] text-14 text-ink-secondary">
        Block {forecast.current_block} now, revisable from block{" "}
        {forecast.revision_horizon_block}. Everything before that is locked —
        no forecast accuracy can change it.
      </p>
    </div>
  );
}

/* ── Decisions summary ───────────────────────────────────────────────────
   A pointer into the despatch plan, not a duplicate of it. The full merit
   order lives on its own page; what belongs here is whether there is anything
   to act on at all. */

function DecisionsSummary({
  decisions,
  siteId,
}: {
  decisions: DecisionResponse;
  siteId: string;
}) {
  const actionable = decisions.actions.filter((a) => a.actionable);
  const lead = actionable[0];
  const hasAlert =
    decisions.worst_block &&
    decisions.blocks.find((b) => b.block === decisions.worst_block)?.risk !== "good";

  return (
    <Panel
      title="Operational status & decision"
      meta={
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{
              background: hasAlert ? "var(--status-serious)" : "var(--status-good)",
            }}
            aria-hidden="true"
          />
          <span className="font-medium">
            {hasAlert ? "Action recommended" : "Operating on schedule"}
          </span>
        </span>
      }
      action={
        <Link
          href={`/sites/${siteId}/decisions`}
          className="rounded-control bg-[var(--ink-primary)] px-3 py-1 text-12 font-medium text-[var(--surface)] hover:opacity-90 active:opacity-100"
        >
          Despatch plan →
        </Link>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="max-w-[86ch] text-15 font-medium text-ink-primary">
          {decisions.headline}
        </p>

        {lead ? (
          <div className="rounded border border-[var(--gridline)] bg-[var(--page)]/50 px-3 py-2 text-12">
            <span className="font-semibold text-ink-primary">Top recommendation: </span>
            <span className="text-ink-secondary">
              {ACTION_LABELS[lead.action] ?? lead.action} at {lead.magnitude_mw.toFixed(0)} MW (
              {lead.block_start === lead.block_end
                ? `block ${lead.block_start}`
                : `blocks ${lead.block_start}–${lead.block_end}`}
              ) — {lead.rationale}
            </span>
          </div>
        ) : null}

        <dl className="mt-1 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-[var(--gridline)] pt-3 sm:grid-cols-4">
          <Stat
            label="Actionable now"
            value={String(actionable.length)}
            note={`${decisions.actions.length} scheduled today`}
          />
          <Stat
            label="Shortfall risk"
            value={mwh(decisions.deficit_energy_mwh)}
            note="Against P10 floor"
          />
          <Stat
            label="Curtailment"
            value={mwh(decisions.curtailment_energy_mwh)}
            note="Above evacuation limit"
            tone={decisions.curtailment_energy_mwh > 0 ? "negative" : undefined}
          />
          <Stat
            label="Worst deviation"
            value={
              decisions.worst_block ? blockStartLabel(decisions.worst_block) : "None"
            }
            note={decisions.worst_block ? `Block ${decisions.worst_block}` : "On plan all day"}
          />
        </dl>
      </div>
    </Panel>
  );
}

/* ── Plant configuration ─────────────────────────────────────────────────
   The physics inputs, on screen. A forecast whose assumptions are hidden is a
   forecast nobody can argue with, and the assumptions here are the ones that
   move the answer most: tilt and tracking for solar, hub height and turbine
   class for wind. */

function PlantConfiguration({ site }: { site: Site }) {
  return (
    <Panel
      title="Plant configuration"
      meta={`${site.latitude.toFixed(3)}, ${site.longitude.toFixed(3)} · ${site.elevation_m} m`}
      footnote="These are the Stage A physics inputs. Changing any of them changes the forecast, which is why they are shown rather than buried in a config file."
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
        <Stat
          label="Evacuation limit"
          value={mw(site.evacuation_limit_mw)}
          note={
            site.evacuation_limit_mw < site.capacity_mw
              ? `${mw(site.capacity_mw - site.evacuation_limit_mw)} below nameplate`
              : "At or above nameplate"
          }
          tone={site.evacuation_limit_mw < site.capacity_mw ? "negative" : undefined}
        />

        {site.solar ? (
          <>
            <Stat
              label="Array"
              value={site.solar.tracking === "single_axis" ? "Single-axis" : "Fixed tilt"}
              note={`${site.solar.tilt_deg}° tilt · ${site.solar.azimuth_deg}° azimuth`}
            />
            <Stat
              label="DC:AC ratio"
              value={site.solar.dc_ac_ratio.toFixed(2)}
              note="Above 1.0 clips the inverter at midday"
            />
            <Stat
              label="System losses"
              value={percent(site.solar.system_losses, 0)}
              note={`${percent(site.solar.inverter_efficiency, 1)} inverter efficiency`}
            />
          </>
        ) : null}

        {site.wind ? (
          <>
            <Stat
              label="Turbines"
              value={`${site.wind.n_turbines}`}
              note={`${site.wind.rotor_diameter_m} m rotor · ${site.wind.turbine_class.replace("iec_", "IEC ").toUpperCase()}`}
            />
            <Stat
              label="Hub height"
              value={`${site.wind.hub_height_m} m`}
              note="Shear solved from 10 m and 100 m wind, not assumed"
            />
            <Stat
              label="Wake and availability"
              value={percent(site.wind.wake_loss, 0)}
              note={`${percent(site.wind.availability, 1)} available`}
            />
          </>
        ) : null}

        {site.battery ? (
          <Stat
            label="Storage"
            value={`${site.battery.energy_mwh} MWh`}
            note={`${mw(site.battery.power_mw)} · ${(site.battery.energy_mwh / site.battery.power_mw).toFixed(1)} h at rated power`}
          />
        ) : (
          <Stat label="Storage" value="None" note="Surplus becomes curtailment" />
        )}
      </dl>
    </Panel>
  );
}
