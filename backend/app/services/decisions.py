"""From forecast to instruction — the decisions layer.

A probability band is not an answer. "Between 1420 and 1780 MW at 14:15" tells
an operator nothing about what to do at 14:15. This module closes that gap: it
compares the forecast against what the plant declared, against what the grid can
physically evacuate, and against the assets available to absorb the difference,
then returns instructions with a price on them.

## The asymmetry is the design

Each decision is judged against a different quantile, and the choice of which is
not a detail:

    deficit      schedule − P10      the credible floor
    surplus      P90 − schedule      the credible ceiling
    curtailment  P90 − evacuation    what the wires cannot take
    energy       P50                 revenue and MWh accounting

Covering a shortfall against P50 is the mistake this framing exists to prevent.
The median is, by construction, wrong half the time in the direction that hurts;
an operator who arranges standby against it is under-covered every other day.
Conversely, sizing storage against P50 leaves a battery full when the real peak
arrives, which is the same error pointing the other way.

## Merit order, not a list of options

Actions are ordered by what the Indian market actually does, cheapest first:

    surplus   battery charge  →  curtail
    deficit   battery discharge  →  gas peaker  →  diesel

Curtailment is last for surplus because it destroys energy that has already been
generated at zero marginal cost. Diesel is last for deficit because at ₹22,000
per MWh and 0.75 t/MWh it is the most expensive and dirtiest thing in the stack.
The ordering is the recommendation — a page that lists five options without
ranking them has handed the judgement back to the reader.

## Runs, not rows

Nine consecutive blocks each saying "charge 100 MW" is a chart. One row saying
"charge 100 MW across blocks 44–52, 225 MWh, saves ₹4.1 lakh" is an instruction.
Contiguous blocks with the same action are collapsed before returning.

## The schedule curve is simulated, and says so

Real declared-capability filings are not public per-block data. The curve here
is the P50 of a forecast issued at 06:00 of the same despatch day — a genuine
day-ahead declaration shape, degraded by a day of real weather error, which is
exactly how a real declaration goes stale. `schedule_basis` carries that fact in
every response so the UI can label it and never present it as a filed schedule.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from app.core.timeblocks import IST, block_label, now_ist, revision_horizon_block
from app.data.constants import (
    BATTERY_LCOS_PER_MWH,
    BATTERY_ROUND_TRIP_EFFICIENCY,
    BLOCK_MINUTES,
    BLOCKS_PER_DAY,
    DIESEL_COST_PER_MWH,
    DIESEL_EMISSION_FACTOR,
    GAS_PEAKER_COST_PER_MWH,
    GAS_PEAKER_EMISSION_FACTOR,
    GRID_EMISSION_FACTOR,
    SOLAR_PPA_TARIFF,
    WIND_PPA_TARIFF,
)
from app.data.sites import Site
from app.schemas import (
    ActionType,
    BlockDecision,
    DecisionResponse,
    ForecastBlock,
    ForecastResponse,
    RecommendedAction,
    RiskEvent,
    RiskLevel,
)

log = logging.getLogger("renewcast.decisions")

# Hours of energy in one despatch block. Every MW→MWh conversion goes through
# this name so the factor of four is impossible to drop silently.
BLOCK_HOURS = BLOCK_MINUTES / 60.0

# Deviation thresholds as a fraction of nameplate.
#
# Expressed against capacity rather than in MW so one set of numbers works for
# 790 MW Charanka and 2245 MW Bhadla. A 60 MW deviation is noise at Bhadla and
# a serious event at Charanka, and thresholds in absolute MW would call them the
# same thing.
RISK_WATCH = 0.03
RISK_SERIOUS = 0.08
RISK_CRITICAL = 0.15

# Battery state of charge assumed at the start of the despatch day. Without
# telemetry this has to be assumed; half full is the neutral choice, leaving
# room to absorb a midday surplus and reserve to cover an evening ramp.
INITIAL_SOC_FRACTION = 0.50

# Minimum size worth surfacing, as a fraction of nameplate. Below this the
# recommendation is noise dressed as advice.
MIN_ACTION_FRACTION = 0.01

# How far below the central estimate a generator files its declared capability.
#
# Under the ABT/DSM settlement regime the consequences of under-delivering
# against a declaration are worse than the foregone upside of over-delivering,
# so the rational filing is deliberately conservative. Four percent is the
# order of magnitude that produces a plausible mix of small deficits and
# moderate surpluses across a day rather than a wall of one or the other.
DECLARATION_HAIRCUT = 0.96

# Flexible gas capacity available to cover a shortfall, as a fraction of the
# site's nameplate. Stands in for locally contracted peaking support; anything
# beyond it falls through to diesel, which is the expensive, dirty end of the
# stack and should be a last resort rather than a routine recommendation.
GAS_PEAKER_SHARE_OF_CAPACITY = 0.20


def tariff_for(site: Site) -> float:
    """PPA tariff in ₹/MWh. Curtailed energy is revenue forgone at this rate."""
    return SOLAR_PPA_TARIFF if site.technology == "solar" else WIND_PPA_TARIFF


# ═════════════════════════════════════════════════════════════════════════
# BATTERY WALK
# ═════════════════════════════════════════════════════════════════════════


@dataclass
class BatteryStep:
    """What the battery does in one block, after the constraints have bound."""

    charge_mw: float = 0.0
    discharge_mw: float = 0.0
    soc_mwh: float = 0.0


def _battery_walk(
    site: Site, surplus_mw: np.ndarray, deficit_mw: np.ndarray
) -> list[BatteryStep]:
    """Simulate the battery block by block, greedily, forward in time.

    Sequential by necessity: state of charge couples every block to the one
    before it. A per-block optimum computed independently would happily
    recommend charging 100 MW in nine consecutive blocks from a battery with
    four hours of energy, which is the kind of recommendation that looks
    quantitative and is physically impossible.

    Greedy rather than optimal, and that is a deliberate trade. A full
    linear-programme despatch would squeeze out a few more percent by holding
    charge for a later, more valuable block — but it would also produce a plan
    no operator could explain, and it would need a price forecast we do not
    have. Greedy is what a control room does: absorb the surplus in front of
    you, cover the shortfall in front of you.

    Round-trip efficiency is charged on the way in, once. Applying it at both
    ends is a common double-count that quietly makes storage look 12% worse
    than it is.
    """
    n = len(surplus_mw)
    steps = [BatteryStep() for _ in range(n)]

    if site.battery is None:
        return steps

    power_cap = site.battery.power_mw
    energy_cap = site.battery.energy_mwh
    soc = INITIAL_SOC_FRACTION * energy_cap

    for i in range(n):
        if surplus_mw[i] > 0.0:
            room_mwh = energy_cap - soc
            # Three limits bind: the inverter, the surplus on offer, and the
            # empty space in the pack. Whichever is smallest wins.
            mw = min(power_cap, float(surplus_mw[i]), room_mwh / (BLOCK_HOURS * BATTERY_ROUND_TRIP_EFFICIENCY))
            if mw > 0.0:
                soc += mw * BLOCK_HOURS * BATTERY_ROUND_TRIP_EFFICIENCY
                steps[i].charge_mw = mw

        elif deficit_mw[i] > 0.0:
            mw = min(power_cap, float(deficit_mw[i]), soc / BLOCK_HOURS)
            if mw > 0.0:
                soc -= mw * BLOCK_HOURS
                steps[i].discharge_mw = mw

        steps[i].soc_mwh = soc

    return steps


# ═════════════════════════════════════════════════════════════════════════
# SCHEDULE CURVE
# ═════════════════════════════════════════════════════════════════════════


def synthesise_schedule(
    forecast: ForecastResponse, rows: list[ForecastBlock] | None = None
) -> np.ndarray:
    """A plausible declared-capability curve for the despatch day.

    Built from the forecast's own P50, then shaped the two ways a real
    day-ahead declaration differs from the forecast that eventually arrives:

      smoothing    a declaration is filed as a smooth shape, not a
                   block-by-block tracking of every cloud. A three-block rolling
                   mean reproduces that: the filed curve cannot know about a
                   15-minute transient.

      conservatism a generator declares slightly *under* what it expects. Under
                   the ABT/DSM regime the penalty for falling short of a
                   declaration is asymmetric with the reward for exceeding it,
                   so the rational filing sits a few percent below the central
                   estimate. Modelled as a 4% haircut plus a slow intra-day
                   drift centred on zero.

    The drift is one sinusoid across the day rather than per-block noise,
    because real declaration error is systematic within a day — a view formed
    yesterday morning is wrong in the same direction for hours at a time, not
    independently in each block.

    The conservatism term matters more than it looks. Without it — with the
    drift centred on 1.0 rather than 0.96 — the declared curve sits above P10
    almost everywhere, every block reads as a shortfall, and the engine
    recommends diesel at a solar plant at noon. That is not a pricing bug; it
    is an input that does not describe how generators actually file.

    This is simulated. `DecisionResponse.schedule_basis` says so.
    """
    p50 = np.array([b.p50 for b in (rows if rows is not None else forecast.blocks)], dtype=float)
    n = len(p50)
    if n == 0:
        return p50

    # Smooth: centred 3-block window, edges held rather than shrunk to zero.
    kernel = np.ones(3) / 3.0
    padded = np.concatenate([[p50[0]], p50, [p50[-1]]])
    smooth = np.convolve(padded, kernel, mode="valid")[:n]

    # Deterministic per despatch date, so the page does not reshuffle on every
    # refresh. A schedule that changes when you reload is a schedule nobody
    # believes.
    seed = int(forecast.despatch_date.replace("-", "")) % 9973
    rng = np.random.default_rng(seed)
    phase = rng.uniform(0.0, 2.0 * np.pi)
    amplitude = rng.uniform(0.03, 0.07)
    drift = DECLARATION_HAIRCUT + amplitude * np.sin(
        2.0 * np.pi * np.arange(n) / max(n, 1) + phase
    )

    return np.clip(smooth * drift, 0.0, forecast.site.capacity_mw)


# ═════════════════════════════════════════════════════════════════════════
# RISK SEVERITY & DRIVER ATTRIBUTION (PHASE 5)
# ═════════════════════════════════════════════════════════════════════════


def _tod_criticality(block: int) -> float:
    """Criticality factor based on Indian grid demand pattern.

    Blocks 1..96 (15 min each):
      18:00–23:00 (Blocks 73..92): Evening peak demand (1.0)
      06:00–09:00 (Blocks 25..36): Morning ramp (0.6)
      10:00–17:00 (Blocks 41..68): Daytime solar peak (0.4)
      23:00–06:00 (Blocks 93..96, 1..24): Night / off-peak (0.2)
      All other blocks: 0.3
    """
    if 73 <= block <= 92:
        return 1.0
    if 25 <= block <= 36:
        return 0.6
    if 41 <= block <= 68:
        return 0.4
    if block > 92 or block < 25:
        return 0.2
    return 0.3


def compute_severity(
    capacity_mw: float,
    peak_deviation_mw: float,
    peak_curtailment_mw: float = 0.0,
    duration_hours: float = BLOCK_HOURS,
    tod_blocks: int | list[int] = 48,
    width_mw: float = 0.0,
) -> int:
    """Calculate 0–100 operational severity score.

    Formula from specification (§7.1):
      severity = 100 * [w1 * mag_ratio + w2 * dur_ratio + w3 * tod_ratio + w4 * width_ratio]
      where w1=0.45, w2=0.25, w3=0.15, w4=0.15

    - Short small deviations remain low severity (< 25, Good).
    - Longer and/or larger deviations scale up to Serious and Critical (75–100).
    """
    cap = max(float(capacity_mw), 1.0)
    eff_mw = abs(float(peak_deviation_mw)) + 1.5 * float(peak_curtailment_mw)

    # Negligible deviation (< 1% of capacity) carries no operational severity
    if eff_mw < 0.01 * cap:
        return 0

    mag_ratio = min(eff_mw / (0.20 * cap), 1.0)
    dur_ratio = min(max(float(duration_hours), 0.0) / 6.0, 1.0)

    if isinstance(tod_blocks, list) and tod_blocks:
        tod_ratio = max((_tod_criticality(b) for b in tod_blocks), default=0.4)
    elif isinstance(tod_blocks, int):
        tod_ratio = _tod_criticality(tod_blocks)
    else:
        tod_ratio = 0.4

    width_ratio = min(max(float(width_mw), 0.0) / (0.30 * cap), 1.0)

    raw = 100.0 * (0.45 * mag_ratio + 0.25 * dur_ratio + 0.15 * tod_ratio + 0.15 * width_ratio)
    return int(round(float(np.clip(raw, 0.0, 100.0))))


def severity_to_risk_level(severity: int) -> RiskLevel:
    """Map 0–100 severity score to operational risk levels:
      Good: <25
      Watch: 25–49
      Serious: 50–74
      Critical: 75–100
    """
    if severity >= 75:
        return "critical"
    if severity >= 50:
        return "serious"
    if severity >= 25:
        return "watch"
    return "good"


def _risk_level(deviation_mw: float, curtailment_mw: float, capacity_mw: float) -> RiskLevel:
    """Legacy helper maintained for test and internal compatibility."""
    sev = compute_severity(
        capacity_mw=capacity_mw,
        peak_deviation_mw=deviation_mw,
        peak_curtailment_mw=curtailment_mw,
        duration_hours=BLOCK_HOURS,
        tod_blocks=48,
        width_mw=0.0,
    )
    return severity_to_risk_level(sev)


def attribute_driver(
    site: Site,
    event_type: str,
    blocks_slice: list[ForecastBlock],
    decision_slice: list[BlockDecision],
    peak_dev: float,
    peak_curt: float,
) -> tuple[str, str]:
    """Derive deterministic, data-supported physical driver and telemetry detail.

    Returns (driver_sentence, driver_detail).
    """
    is_solar = site.technology == "solar"
    is_wind = site.technology == "wind"

    temps = [b.temp_c for b in blocks_slice if b.temp_c is not None]
    clouds = [b.cloud_pct for b in blocks_slice if b.cloud_pct is not None]
    winds = [b.wind_ms for b in blocks_slice if b.wind_ms is not None]
    winds_100 = [b.wind_100_ms for b in blocks_slice if b.wind_100_ms is not None]
    ghis = [b.ghi for b in blocks_slice if b.ghi is not None]
    csis = [b.clear_sky_index for b in blocks_slice if b.clear_sky_index is not None]
    elevs = [b.solar_elevation for b in blocks_slice if b.solar_elevation is not None]

    max_temp = float(np.max(temps)) if temps else None
    avg_cloud = float(np.mean(clouds)) if clouds else None
    min_cloud = float(np.min(clouds)) if clouds else None
    max_cloud = float(np.max(clouds)) if clouds else None
    avg_wind = float(np.mean(winds)) if winds else None
    avg_w100 = float(np.mean(winds_100)) if winds_100 else None
    min_w100 = float(np.min(winds_100)) if winds_100 else (avg_wind if avg_wind is not None else None)
    max_w100 = float(np.max(winds_100)) if winds_100 else (avg_wind if avg_wind is not None else None)
    avg_ghi = float(np.mean(ghis)) if ghis else None
    avg_csi = float(np.mean(csis)) if csis else None
    min_elev = float(np.min(elevs)) if elevs else None
    max_elev = float(np.max(elevs)) if elevs else None

    b_start = min((b.block for b in blocks_slice), default=1)
    b_end = max((b.block for b in blocks_slice), default=96)
    peak_sched = max((b.schedule_mw for b in decision_slice), default=0.0)
    min_p10 = min((b.p10 for b in decision_slice), default=0.0)

    # 1. Curtailment
    if event_type == "curtailment" or peak_curt > 0.02 * site.capacity_mw:
        max_p90 = max((b.p90 for b in decision_slice), default=site.evacuation_limit_mw)
        driver = f"Expected output exceeds the {site.evacuation_limit_mw:,.0f} MW evacuation limit"
        detail = (
            f"Peak P90 generation reaches {max_p90:,.0f} MW against "
            f"{site.evacuation_limit_mw:,.0f} MW transmission limit."
        )
        return driver, detail

    # 2. Deficit
    if event_type == "deficit":
        if is_solar:
            # Evening solar ramp
            if b_end >= 68 and (min_elev is None or min_elev <= 15.0):
                driver = (
                    "Post-sunset solar ramp reduces available generation while the "
                    "committed schedule remains elevated."
                )
                elev_str = f"{min_elev:.1f}°" if min_elev is not None else "< 10°"
                detail = f"Solar elevation drops to {elev_str}; PV generation rapidly drops below declaration."
                return driver, detail

            # Morning ramp lag
            if b_start <= 32 and (max_elev is None or max_elev <= 25.0):
                driver = "Morning solar ramp lag: declaration opens before solar irradiance pickup"
                ghi_str = f"{avg_ghi:.0f} W/m²" if avg_ghi is not None else "low"
                detail = f"GHI is {ghi_str} with solar elevation still climbing; actual pickup lags declaration schedule."
                return driver, detail

            # Cloud cover rising or dense cloud
            if avg_cloud is not None and (avg_cloud >= 50.0 or (avg_csi is not None and avg_csi < 0.50)):
                if max_cloud is not None and min_cloud is not None and (max_cloud - min_cloud) >= 20.0:
                    driver = "Cloud cover rises sharply through the event window"
                else:
                    driver = f"Dense cloud cover ({avg_cloud:.0f}%) suppressing solar irradiance"
                ghi_str = f", GHI: {avg_ghi:.0f} W/m²" if avg_ghi is not None else ""
                csi_str = f", Clearsky Index: {avg_csi:.2f}" if avg_csi is not None else ""
                detail = f"Cloud cover: {avg_cloud:.0f}%{csi_str}{ghi_str}; diffuse fraction significantly elevated."
                return driver, detail

            # Thermal derate
            if max_temp is not None and max_temp >= 40.0:
                driver = f"High ambient temperature ({max_temp:.1f}°C) causing thermal derate on PV modules"
                detail = f"Ambient temp reached {max_temp:.1f}°C; cell efficiency losses degrade peak generation below schedule."
                return driver, detail

            # Safe factual fallback
            driver = "Forecast generation falls below the P10 floor"
            detail = f"P10 floor drops to {min_p10:.0f} MW against {peak_sched:.0f} MW declared schedule."
            return driver, detail

        if is_wind:
            # Cut-in shutdown
            effective_w = min_w100 if min_w100 is not None else avg_wind
            if effective_w is not None and effective_w < 3.0:
                driver = f"v100 {effective_w:.1f} m/s below cut-in 3.0 m/s"
                detail = f"Hub-height wind speed {effective_w:.1f} m/s drops below turbine cut-in threshold (3.0 m/s)."
                return driver, detail

            # Cut-out shutdown
            high_w = max_w100 if max_w100 is not None else avg_wind
            if high_w is not None and high_w >= 24.0:
                driver = f"High wind cutout shutdown: wind speed {high_w:.1f} m/s exceeds safe limit"
                detail = f"Hub-height winds reached {high_w:.1f} m/s; aerodynamic braking engaged for asset protection."
                return driver, detail

            # Sub-rated wind speed
            if effective_w is not None and effective_w < 6.5:
                driver = f"Sub-rated wind speed ({effective_w:.1f} m/s) in cubic power drop region"
                detail = f"Hub wind speed {effective_w:.1f} m/s sits in the steep non-linear power curve regime."
                return driver, detail

            # Fallback wind deficit
            driver = "Forecast generation falls below the P10 floor"
            detail = f"P10 floor is {min_p10:.0f} MW against declared schedule of {peak_sched:.0f} MW."
            return driver, detail

    # 3. Surplus
    if event_type == "surplus":
        if is_solar and avg_cloud is not None and avg_cloud <= 20.0 and avg_ghi is not None and avg_ghi > 500:
            driver = "Clear sky irradiance outperforming conservative declaration"
            detail = f"Cloud cover at {avg_cloud:.0f}% with GHI {avg_ghi:.0f} W/m² yields higher than declared output."
            return driver, detail
        if is_wind and avg_w100 is not None and avg_w100 >= 8.5:
            driver = f"Strong sustained hub wind ({avg_w100:.1f} m/s) driving generation above declaration"
            detail = f"Hub winds average {avg_w100:.1f} m/s across the window."
            return driver, detail
        driver = "Expected output exceeds declared schedule"
        p90_max = max((b.p90 for b in decision_slice), default=0.0)
        min_sched = min((b.schedule_mw for b in decision_slice), default=0.0)
        detail = f"P90 generation reaches {p90_max:.0f} MW against {min_sched:.0f} MW declared schedule."
        return driver, detail

    return "Forecast tracks declared schedule within normal tolerance", "No significant deviation detected."


def detect_events(
    site: Site,
    block_decisions: list[BlockDecision],
    forecast_blocks: list[ForecastBlock],
    actions: list[RecommendedAction],
    horizon_block: int,
) -> list[RiskEvent]:
    """Group contiguous risk blocks into unified operational events."""
    cap = site.capacity_mw
    n = len(block_decisions)
    if n == 0:
        return []

    # Tag each block with its active risk condition
    tags: list[str | None] = []
    for d in block_decisions:
        if d.curtailment_mw > 0.02 * cap:
            tags.append("curtailment")
        elif d.deficit_mw > 0.02 * cap:
            tags.append("deficit")
        elif d.surplus_mw > 0.05 * cap:
            tags.append("surplus")
        else:
            tags.append(None)

    events: list[RiskEvent] = []
    i = 0
    while i < n:
        tag = tags[i]
        if tag is None:
            i += 1
            continue

        j = i
        while j + 1 < n and tags[j + 1] == tag:
            j += 1

        b_start = block_decisions[i].block
        b_end = block_decisions[j].block
        duration_h = (j - i + 1) * BLOCK_HOURS

        sub_decisions = block_decisions[i : j + 1]
        sub_forecast = forecast_blocks[i : j + 1]

        if tag == "curtailment":
            peak_dev = max(d.curtailment_mw for d in sub_decisions)
            peak_curt = peak_dev
            energy_mwh = sum(d.curtailment_mw for d in sub_decisions) * BLOCK_HOURS
        elif tag == "deficit":
            peak_dev = max(d.deficit_mw for d in sub_decisions)
            peak_curt = max(d.curtailment_mw for d in sub_decisions)
            energy_mwh = sum(d.deficit_mw for d in sub_decisions) * BLOCK_HOURS
        else:
            peak_dev = max(d.surplus_mw for d in sub_decisions)
            peak_curt = 0.0
            energy_mwh = sum(d.surplus_mw for d in sub_decisions) * BLOCK_HOURS

        run_blocks = [d.block for d in sub_decisions]
        mean_width = float(np.mean([d.p90 - d.p10 for d in sub_decisions]))
        severity = compute_severity(
            capacity_mw=cap,
            peak_deviation_mw=peak_dev,
            peak_curtailment_mw=peak_curt,
            duration_hours=duration_h,
            tod_blocks=run_blocks,
            width_mw=mean_width,
        )
        risk_level = severity_to_risk_level(severity)
        driver, detail = attribute_driver(
            site=site,
            event_type=tag,
            blocks_slice=sub_forecast,
            decision_slice=sub_decisions,
            peak_dev=peak_dev,
            peak_curt=peak_curt,
        )

        # Cross-reference recommended actions for matching operational response
        matching_actions = [
            a for a in actions if (a.block_start <= b_end and a.block_end >= b_start)
        ]
        rec_action = None
        if matching_actions:
            top_action = max(matching_actions, key=lambda a: abs(a.cost_inr))
            rec_action = f"{top_action.action.replace('_', ' ').title()}: {top_action.magnitude_mw:.0f} MW ({top_action.label})"
        elif tag == "deficit":
            rec_action = "Discharge storage or dispatch peaking capacity to cover shortfall"
        elif tag == "curtailment":
            rec_action = "Curtail generation or charge storage to respect transmission limit"
        elif tag == "surplus":
            rec_action = "Charge battery storage to absorb surplus generation"

        # Annotate member block decisions with the event's driver
        for k in range(i, j + 1):
            block_decisions[k].driver = driver

        event = RiskEvent(
            event_type=tag,  # type: ignore[arg-type]
            block_start=b_start,
            block_end=b_end,
            label=_span_label(b_start, b_end),
            peak_deviation_mw=round(peak_dev, 1),
            energy_mwh=round(energy_mwh, 1),
            severity=severity,
            risk_level=risk_level,
            driver=driver,
            driver_detail=detail,
            recommended_action=rec_action,
            actionable=b_end >= horizon_block,
        )
        events.append(event)
        i = j + 1

    # Fill any remaining unassigned block drivers
    for k, d in enumerate(block_decisions):
        if d.driver is None:
            if d.severity >= 25:
                drv, _ = attribute_driver(
                    site,
                    "curtailment" if d.curtailment_mw > 0 else ("deficit" if d.deficit_mw > 0 else "surplus"),
                    [forecast_blocks[k]],
                    [d],
                    abs(d.deviation_mw),
                    d.curtailment_mw,
                )
                d.driver = drv
            else:
                d.driver = "Generation tracks declared schedule within normal tolerance"

    # Sort events by operational priority: highest severity first, then energy
    events.sort(key=lambda e: (-e.severity, -e.energy_mwh))
    return events


# ═════════════════════════════════════════════════════════════════════════
# ACTION GROUPING
# ═════════════════════════════════════════════════════════════════════════


def _span_label(block_start: int, block_end: int) -> str:
    """'11:00–13:00' across a run of blocks.

    Takes the start of the first block and the end of the last, so a one-block
    run renders identically to the block label itself and a nine-block run reads
    as a single window.
    """
    first = block_label(block_start)
    last = block_label(block_end)
    return f"{first.split('–')[0]}–{last.split('–')[-1]}"


def _group_runs(
    action: ActionType,
    magnitudes: np.ndarray,
    blocks: list[BlockDecision],
    site: Site,
    horizon_block: int,
) -> list[RecommendedAction]:
    """Collapse contiguous non-zero blocks of one action into instruction rows.

    A run breaks on a zero block, never on a change of magnitude — the reported
    magnitude is the mean across the run and the energy is the true integral, so
    a ramp inside a window stays honest without fragmenting into nine rows.
    """
    floor = MIN_ACTION_FRACTION * site.capacity_mw
    active = magnitudes > floor
    out: list[RecommendedAction] = []

    i = 0
    n = len(active)
    while i < n:
        if not active[i]:
            i += 1
            continue

        j = i
        while j + 1 < n and active[j + 1]:
            j += 1

        run = magnitudes[i : j + 1]
        energy_mwh = float(run.sum()) * BLOCK_HOURS
        b_start, b_end = blocks[i].block, blocks[j].block
        cost, co2, why = _price(action, energy_mwh, float(run.mean()), site)

        out.append(
            RecommendedAction(
                action=action,
                block_start=b_start,
                block_end=b_end,
                label=_span_label(b_start, b_end),
                magnitude_mw=round(float(run.mean()), 1),
                energy_mwh=round(energy_mwh, 1),
                cost_inr=round(cost, 0),
                co2_tonnes=round(co2, 2),
                rationale=why,
                # Actionable only if the run extends past the revision horizon.
                # A run that ends before it is history with a price tag.
                actionable=b_end >= horizon_block,
            )
        )
        i = j + 1

    return out


def _price(
    action: ActionType, energy_mwh: float, magnitude_mw: float, site: Site
) -> tuple[float, float, str]:
    """Cost in ₹, emissions in tonnes CO₂, and the sentence explaining both.

    Sign convention throughout: **positive cost is money spent, negative is
    money saved**, and the same for carbon. Battery charging against
    curtailment comes out negative on both, which is the point — it is the one
    action in the stack that pays for itself.
    """
    tariff = tariff_for(site)

    if action == "curtail":
        # Energy generated and thrown away. The cost is the revenue that did not
        # happen, plus the emissions that were not avoided — a grid unit had to
        # supply this MWh instead.
        return (
            energy_mwh * tariff,
            energy_mwh * GRID_EMISSION_FACTOR,
            f"P90 exceeds the {site.evacuation_limit_mw:.0f} MW evacuation limit. "
            f"Curtailing {magnitude_mw:.0f} MW forgoes ₹{energy_mwh * tariff / 1e5:.1f} lakh "
            f"and displaces {energy_mwh * GRID_EMISSION_FACTOR:.0f} t of avoided CO₂.",
        )

    if action == "battery_charge":
        delivered = energy_mwh * BATTERY_ROUND_TRIP_EFFICIENCY
        cost = energy_mwh * BATTERY_LCOS_PER_MWH - delivered * tariff
        forgone = energy_mwh * tariff
        # Leads with the comparison rather than restating the action. The action
        # is already named in the card header and in the copilot's fact line, so
        # a rationale opening "Store 73 MW…" is a second instruction wearing a
        # reason's label — the copilot spliced it into "storing 201 MWh to store
        # 73 MW instead of curtailing it".
        reason = (
            f"Storing beats curtailing here: {delivered:.0f} MWh returns later at "
            f"{BATTERY_ROUND_TRIP_EFFICIENCY:.0%} round-trip, against "
            f"₹{forgone / 1e5:.1f} lakh forgone if the energy is spilled."
            if cost < forgone
            else f"Storing costs more than the ₹{forgone / 1e5:.1f} lakh curtailing "
            f"would forgo, so store only what the evacuation limit forces."
        )
        return (
            cost,
            -delivered * GRID_EMISSION_FACTOR,
            reason,
        )

    if action == "battery_discharge":
        return (
            energy_mwh * BATTERY_LCOS_PER_MWH,
            -energy_mwh * GRID_EMISSION_FACTOR,
            f"Stored energy is the cheapest cover available at "
            f"₹{BATTERY_LCOS_PER_MWH / 1000:.1f}k/MWh, and holding the schedule "
            f"this way avoids {energy_mwh * GRID_EMISSION_FACTOR:.0f} t CO₂ "
            f"versus a thermal alternative.",
        )

    if action == "gas_peaker":
        return (
            energy_mwh * GAS_PEAKER_COST_PER_MWH,
            energy_mwh * GAS_PEAKER_EMISSION_FACTOR,
            f"Storage is exhausted or absent. A gas peaker covers {magnitude_mw:.0f} MW "
            f"at ₹{GAS_PEAKER_COST_PER_MWH / 1000:.0f}k/MWh — "
            f"{energy_mwh * GAS_PEAKER_EMISSION_FACTOR:.0f} t CO₂.",
        )

    if action == "diesel":
        return (
            energy_mwh * DIESEL_COST_PER_MWH,
            energy_mwh * DIESEL_EMISSION_FACTOR,
            f"Last resort for {magnitude_mw:.0f} MW: diesel at "
            f"₹{DIESEL_COST_PER_MWH / 1000:.0f}k/MWh and "
            f"{DIESEL_EMISSION_FACTOR:.2f} t/MWh. Both the most expensive and the "
            f"dirtiest option in the stack.",
        )

    return 0.0, 0.0, "No action required."


# ═════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═════════════════════════════════════════════════════════════════════════


def build_decisions(forecast: ForecastResponse) -> DecisionResponse:
    """Turn a probabilistic forecast into a priced despatch plan."""
    site = forecast.site
    cap = site.capacity_mw
    evac = site.evacuation_limit_mw
    issued = forecast.issued_at
    horizon_block = forecast.revision_horizon_block

    # One despatch day, exactly.
    #
    # The forecast window deliberately starts at block 1 of today and runs
    # forward from *now*, so a 24-hour horizon spans about 118 blocks and
    # crosses midnight. Passing that straight through would put block numbers
    # 1–96 in the list and then 1–22 again, and every consumer keyed on block
    # index — the spine, the schedule curve, the battery walk — would see two
    # rows claiming to be block 7. Filtering to the issue date is what makes
    # "block 43" a unique address rather than a label.
    day = forecast.despatch_date
    rows = [b for b in forecast.blocks if b.timestamp.astimezone(IST).date().isoformat() == day]
    if not rows:
        rows = forecast.blocks[:BLOCKS_PER_DAY]

    p10 = np.array([b.p10 for b in rows], dtype=float)
    p50 = np.array([b.p50 for b in rows], dtype=float)
    p90 = np.array([b.p90 for b in rows], dtype=float)
    schedule = synthesise_schedule(forecast, rows)

    deficit = np.maximum(schedule - p10, 0.0)
    surplus = np.maximum(p90 - schedule, 0.0)
    curtailment = np.maximum(p90 - evac, 0.0)
    deviation = p50 - schedule

    # Storage first, because what the battery absorbs is not curtailed and what
    # it delivers is not bought from a peaker. Running this before pricing the
    # fallbacks is what makes the merit order real rather than decorative.
    steps = _battery_walk(site, surplus, deficit)
    charge = np.array([s.charge_mw for s in steps])
    discharge = np.array([s.discharge_mw for s in steps])

    # What the battery could not take still has to be curtailed, and what it
    # could not cover still has to be bought.
    residual_curtail = np.maximum(curtailment - charge, 0.0)
    residual_deficit = np.maximum(deficit - discharge, 0.0)

    # Split the uncovered shortfall across the thermal stack.
    #
    # The gas ceiling is a proxy for locally contracted flexible capacity,
    # taken as a fixed fraction of nameplate. It is deliberately *not* the
    # battery's power rating: the two are unrelated assets, and tying them
    # together made a site with a small battery reach for diesel at a shortfall
    # a site with no battery would have covered with gas — the cheaper, cleaner
    # option — which inverts the merit order the whole module exists to express.
    gas_ceiling = GAS_PEAKER_SHARE_OF_CAPACITY * cap
    gas = np.minimum(residual_deficit, gas_ceiling)
    diesel = np.maximum(residual_deficit - gas_ceiling, 0.0)

    block_rows: list[BlockDecision] = []
    for i, b in enumerate(rows):
        b_dev = float(deviation[i])
        b_curt = float(curtailment[i])
        b_sev = compute_severity(
            capacity_mw=cap,
            peak_deviation_mw=b_dev,
            peak_curtailment_mw=b_curt,
            duration_hours=BLOCK_HOURS,
            tod_blocks=b.block,
            width_mw=float(b.p90 - b.p10),
        )
        block_rows.append(
            BlockDecision(
                block=b.block,
                label=b.label,
                timestamp=b.timestamp,
                locked=b.block < horizon_block,
                p10=b.p10,
                p50=b.p50,
                p90=b.p90,
                schedule_mw=round(float(schedule[i]), 1),
                deviation_mw=round(b_dev, 1),
                deficit_mw=round(float(deficit[i]), 1),
                surplus_mw=round(float(surplus[i]), 1),
                curtailment_mw=round(b_curt, 1),
                risk=severity_to_risk_level(b_sev),
                severity=b_sev,
                driver=None,
                headroom_mw=round(float(evac - p50[i]), 1),
            )
        )

    actions: list[RecommendedAction] = []
    for action, magnitudes in (
        ("battery_charge", charge),
        ("battery_discharge", discharge),
        ("curtail", residual_curtail),
        ("gas_peaker", gas),
        ("diesel", diesel),
    ):
        actions.extend(_group_runs(action, magnitudes, block_rows, site, horizon_block))

    # Order: actionable before locked, then by absolute financial weight. An
    # operator reads top-down and should meet the biggest thing they can still
    # do something about first.
    actions.sort(key=lambda a: (not a.actionable, -abs(a.cost_inr)))

    # Detect grouped operational events and attribute physical drivers
    events = detect_events(site, block_rows, rows, actions, horizon_block)

    worst = int(np.argmax(np.abs(deviation))) if len(deviation) else None

    return DecisionResponse(
        site=site,
        despatch_date=forecast.despatch_date,
        issued_at=issued,
        current_block=forecast.current_block,
        revision_horizon_block=horizon_block,
        schedule_basis=(
            "Simulated day-ahead declaration: smoothed P50 with a systematic "
            "intra-day drift. Not a filed schedule."
        ),
        blocks=block_rows,
        actions=actions,
        events=events,
        deficit_energy_mwh=round(float(deficit.sum()) * BLOCK_HOURS, 1),
        surplus_energy_mwh=round(float(surplus.sum()) * BLOCK_HOURS, 1),
        curtailment_energy_mwh=round(float(curtailment.sum()) * BLOCK_HOURS, 1),
        net_cost_inr=round(sum(a.cost_inr for a in actions), 0),
        net_co2_tonnes=round(sum(a.co2_tonnes for a in actions), 2),
        worst_block=block_rows[worst].block if worst is not None and block_rows else None,
        headline=_headline(site, block_rows, actions, float(curtailment.sum()) * BLOCK_HOURS, events),
    )


def _headline(
    site: Site,
    blocks: list[BlockDecision],
    actions: list[RecommendedAction],
    curtail_mwh: float,
    events: list[RiskEvent] | None = None,
) -> str:
    """One sentence for the top of the page.

    Written here rather than in the client so the sentence and the numbers
    beside it come from the same arithmetic. A headline computed in TypeScript
    from a payload computed in Python is a headline that will eventually
    contradict the table under it.
    """
    if events:
        critical_events = [e for e in events if e.risk_level == "critical"]
        serious_events = [e for e in events if e.risk_level == "serious"]
        if critical_events:
            ev = critical_events[0]
            return f"Critical {ev.event_type} risk: {ev.label} ({ev.peak_deviation_mw:.0f} MW peak, severity {ev.severity}). {ev.driver}"
        if serious_events:
            ev = serious_events[0]
            return f"Serious {ev.event_type} risk: {ev.label} ({ev.peak_deviation_mw:.0f} MW peak, severity {ev.severity}). {ev.driver}"

    critical = [b for b in blocks if b.risk == "critical"]
    serious = [b for b in blocks if b.risk == "serious"]
    actionable = [a for a in actions if a.actionable]

    if curtail_mwh > 1.0:
        return (
            f"{curtail_mwh:.0f} MWh at risk of curtailment against the "
            f"{site.evacuation_limit_mw:.0f} MW evacuation limit."
        )
    if critical:
        return (
            f"{len(critical)} block{'s' if len(critical) > 1 else ''} at critical "
            f"deviation, worst at {critical[0].label}."
        )
    if serious:
        n = len(serious)
        return (
            f"{n} block{'s' if n > 1 else ''} deviate{'' if n > 1 else 's'} "
            f"seriously from the declared schedule."
        )
    if actionable:
        return f"{len(actionable)} recommended action{'s' if len(actionable) > 1 else ''} inside the revision window."
    return "Forecast tracks the declared schedule across the day. No action required."


__all__ = [
    "build_decisions",
    "synthesise_schedule",
    "tariff_for",
    "compute_severity",
    "severity_to_risk_level",
    "attribute_driver",
    "detect_events",
    "BLOCK_HOURS",
]
