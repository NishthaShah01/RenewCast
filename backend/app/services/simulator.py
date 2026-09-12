"""What-If Simulator service.

Reuses the exact same dispatch calculation path as the decision engine.
Compares a baseline asset/economic configuration against a modified scenario.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.core.timeblocks import IST, BLOCK_MINUTES, BLOCKS_PER_DAY
from app.data.constants import (
    BATTERY_LCOS_PER_MWH,
    BATTERY_ROUND_TRIP_EFFICIENCY,
    DIESEL_COST_PER_MWH,
    DIESEL_EMISSION_FACTOR,
    GAS_PEAKER_COST_PER_MWH,
    GAS_PEAKER_EMISSION_FACTOR,
    GRID_EMISSION_FACTOR,
)
from app.data.sites import Site, get_site
from app.schemas import (
    AttributionItem,
    BlockDecision,
    BreakEvenResult,
    ForecastResponse,
    RecommendedAction,
    SimulationDeltas,
    SimulationMetrics,
    SimulatorRequest,
    SimulatorResponse,
    SimulatorTimelineBlock,
)
from app.services.decisions import (
    BLOCK_HOURS,
    GAS_PEAKER_SHARE_OF_CAPACITY,
    INITIAL_SOC_FRACTION,
    _group_runs,
    _risk_level,
    synthesise_schedule,
    tariff_for,
)
from app.services.forecast import generate_forecast

log = logging.getLogger("renewcast.simulator")


@dataclass
class DispatchResult:
    site: Site
    metrics: SimulationMetrics
    actions: list[RecommendedAction]
    block_rows: list[BlockDecision]
    deficit_energy_mwh: float
    surplus_energy_mwh: float
    curtailment_energy_mwh: float
    dispatched_mw: np.ndarray
    unserved_mw: np.ndarray
    curtailment_mw: np.ndarray
    schedule_mw: np.ndarray
    evacuation_limit_mw: float


def simulate_dispatch(
    forecast: ForecastResponse,
    *,
    site: Site | None = None,
    battery_power_mw: float | None = None,
    battery_energy_mwh: float | None = None,
    battery_initial_soc_pct: float | None = None,
    battery_rte_pct: float | None = None,
    flexible_demand_mw: float = 0.0,
    backup_capacity_mw: float | None = None,
    backup_notice_hours: float = 0.0,
    evacuation_limit_mw: float | None = None,
    tariff_per_mwh: float | None = None,
    gas_peaker_cost_per_mwh: float | None = None,
    diesel_cost_per_mwh: float | None = None,
    grid_emission_factor: float | None = None,
) -> DispatchResult:
    """Core dispatch simulation shared by decisions and scenario modeling.

    Merit order (cheapest and cleanest first):
      Surplus: battery charge -> flexible demand absorb -> curtailment
      Deficit: battery discharge -> demand shift -> gas peaker -> diesel -> unserved
    """
    s = site or forecast.site
    cap = s.capacity_mw
    evac = evacuation_limit_mw if evacuation_limit_mw is not None else s.evacuation_limit_mw
    tariff = tariff_per_mwh if tariff_per_mwh is not None else tariff_for(s)
    gas_cost = gas_peaker_cost_per_mwh if gas_peaker_cost_per_mwh is not None else GAS_PEAKER_COST_PER_MWH
    diesel_cost = diesel_cost_per_mwh if diesel_cost_per_mwh is not None else DIESEL_COST_PER_MWH
    grid_ef = grid_emission_factor if grid_emission_factor is not None else GRID_EMISSION_FACTOR
    gas_ef = GAS_PEAKER_EMISSION_FACTOR
    diesel_ef = DIESEL_EMISSION_FACTOR

    # Battery sizing & parameters
    p_batt = battery_power_mw if battery_power_mw is not None else (s.battery.power_mw if s.battery else 0.0)
    e_batt = battery_energy_mwh if battery_energy_mwh is not None else (s.battery.energy_mwh if s.battery else 0.0)
    soc_pct = (
        battery_initial_soc_pct
        if battery_initial_soc_pct is not None
        else ((s.battery.initial_soc * 100.0) if s.battery else (INITIAL_SOC_FRACTION * 100.0))
    )
    rte = (
        (battery_rte_pct / 100.0)
        if battery_rte_pct is not None
        else BATTERY_ROUND_TRIP_EFFICIENCY
    )

    # Backup & Notice
    gas_ceiling = backup_capacity_mw if backup_capacity_mw is not None else (GAS_PEAKER_SHARE_OF_CAPACITY * cap)
    notice_blocks = int(round(backup_notice_hours * (60.0 / BLOCK_MINUTES)))
    gate_block = forecast.current_block + notice_blocks

    # 1 dispatch day (96 blocks)
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

    n = len(rows)
    charge = np.zeros(n)
    discharge = np.zeros(n)
    soc = (soc_pct / 100.0) * e_batt if e_batt > 0 else 0.0

    # Battery walk
    if p_batt > 0 and e_batt > 0 and rte > 0:
        for i in range(n):
            if surplus[i] > 0.0:
                room_mwh = max(e_batt - soc, 0.0)
                mw = min(p_batt, float(surplus[i]), room_mwh / (BLOCK_HOURS * rte))
                if mw > 0.0:
                    soc += mw * BLOCK_HOURS * rte
                    charge[i] = mw
            elif deficit[i] > 0.0:
                mw = min(p_batt, float(deficit[i]), soc / BLOCK_HOURS)
                if mw > 0.0:
                    soc -= mw * BLOCK_HOURS
                    discharge[i] = mw

    residual_curtail = np.maximum(curtailment - charge, 0.0)
    residual_deficit = np.maximum(deficit - discharge, 0.0)

    # Demand flexibility: absorbs deficit during shortfall
    flex_shift = np.zeros(n)
    if flexible_demand_mw > 0.0:
        flex_shift = np.minimum(residual_deficit, flexible_demand_mw)
        residual_deficit = np.maximum(residual_deficit - flex_shift, 0.0)

    # Thermal backup respecting notice window
    gas = np.zeros(n)
    diesel = np.zeros(n)
    for i in range(n):
        b_num = rows[i].block
        if b_num >= gate_block:
            g = min(residual_deficit[i], gas_ceiling)
            d = max(residual_deficit[i] - gas_ceiling, 0.0)
            gas[i] = g
            diesel[i] = d

    unserved = residual_deficit - (gas + diesel)
    unserved_mwh = float(np.maximum(unserved, 0.0).sum()) * BLOCK_HOURS
    curtailed_mwh = float(residual_curtail.sum()) * BLOCK_HOURS
    served_mwh = (
        float(p50.sum()) * BLOCK_HOURS
        + float(discharge.sum()) * BLOCK_HOURS
        + float((gas + diesel).sum()) * BLOCK_HOURS
    )

    # Build action list
    horizon_block = forecast.revision_horizon_block
    block_rows = [
        BlockDecision(
            block=b.block,
            label=b.label,
            timestamp=b.timestamp,
            locked=b.block < horizon_block,
            p10=b.p10,
            p50=b.p50,
            p90=b.p90,
            schedule_mw=round(float(schedule[i]), 1),
            deviation_mw=round(float(deviation[i]), 1),
            deficit_mw=round(float(deficit[i]), 1),
            surplus_mw=round(float(surplus[i]), 1),
            curtailment_mw=round(float(curtailment[i]), 1),
            risk=_risk_level(float(deviation[i]), float(curtailment[i]), cap),
            headroom_mw=round(float(evac - p50[i]), 1),
        )
        for i, b in enumerate(rows)
    ]

    actions: list[RecommendedAction] = []
    for action, mags in (
        ("battery_charge", charge),
        ("battery_discharge", discharge),
        ("curtail", residual_curtail),
        ("demand_shift", flex_shift),
        ("gas_peaker", gas),
        ("diesel", diesel),
    ):
        actions.extend(_group_runs(action, mags, block_rows, s, horizon_block))

    # Reprice with scenario specific parameters
    for a in actions:
        if a.action == "curtail":
            a.cost_inr = round(a.energy_mwh * tariff, 0)
            a.co2_tonnes = round(a.energy_mwh * grid_ef, 2)
        elif a.action == "battery_charge":
            delivered = a.energy_mwh * rte
            a.cost_inr = round(a.energy_mwh * BATTERY_LCOS_PER_MWH - delivered * tariff, 0)
            a.co2_tonnes = round(-delivered * grid_ef, 2)
        elif a.action == "battery_discharge":
            a.cost_inr = round(a.energy_mwh * BATTERY_LCOS_PER_MWH, 0)
            a.co2_tonnes = round(-a.energy_mwh * grid_ef, 2)
        elif a.action == "demand_shift":
            a.cost_inr = round(a.energy_mwh * (tariff * 0.4), 0)
            a.co2_tonnes = round(-a.energy_mwh * grid_ef, 2)
        elif a.action == "gas_peaker":
            a.cost_inr = round(a.energy_mwh * gas_cost, 0)
            a.co2_tonnes = round(a.energy_mwh * gas_ef, 2)
        elif a.action == "diesel":
            a.cost_inr = round(a.energy_mwh * diesel_cost, 0)
            a.co2_tonnes = round(a.energy_mwh * diesel_ef, 2)

    actions.sort(key=lambda a: (not a.actionable, -abs(a.cost_inr)))

    # Net cost includes action costs + penalty on unserved energy
    unserved_cost_rate = diesel_cost * 1.5
    net_cost = sum(a.cost_inr for a in actions) + unserved_mwh * unserved_cost_rate
    net_co2 = sum(a.co2_tonnes for a in actions) + unserved_mwh * diesel_ef

    metrics = SimulationMetrics(
        served_energy_mwh=round(served_mwh, 1),
        curtailed_energy_mwh=round(curtailed_mwh, 1),
        unserved_energy_mwh=round(unserved_mwh, 1),
        net_cost_inr=round(net_cost, 0),
        net_co2_tonnes=round(net_co2, 2),
        deficit_energy_mwh=round(float(deficit.sum()) * BLOCK_HOURS, 1),
        surplus_energy_mwh=round(float(surplus.sum()) * BLOCK_HOURS, 1),
    )

    dispatched_grid = np.minimum(evac, np.maximum(0.0, p50 - charge + discharge + gas + diesel))
    unserved_arr = np.maximum(unserved, 0.0)

    return DispatchResult(
        site=s,
        metrics=metrics,
        actions=actions,
        block_rows=block_rows,
        deficit_energy_mwh=round(float(deficit.sum()) * BLOCK_HOURS, 1),
        surplus_energy_mwh=round(float(surplus.sum()) * BLOCK_HOURS, 1),
        curtailment_energy_mwh=round(float(curtailment.sum()) * BLOCK_HOURS, 1),
        dispatched_mw=dispatched_grid,
        unserved_mw=unserved_arr,
        curtailment_mw=residual_curtail,
        schedule_mw=schedule,
        evacuation_limit_mw=float(evac),
    )


def get_site_defaults(site: Site) -> dict[str, Any]:
    """Retrieve authoritative baseline parameters for a site."""
    cap = site.capacity_mw
    return {
        "site_id": site.id,
        "battery_power_mw": site.battery.power_mw if site.battery else 0.0,
        "battery_energy_mwh": site.battery.energy_mwh if site.battery else 0.0,
        "battery_initial_soc_pct": round((site.battery.initial_soc * 100.0) if site.battery else (INITIAL_SOC_FRACTION * 100.0), 1),
        "battery_rte_pct": round(BATTERY_ROUND_TRIP_EFFICIENCY * 100.0, 1),
        "flexible_demand_mw": 0.0,
        "backup_capacity_mw": round(GAS_PEAKER_SHARE_OF_CAPACITY * cap, 1),
        "backup_notice_hours": 0.0,
        "evacuation_limit_mw": site.evacuation_limit_mw,
        "tariff_per_mwh": tariff_for(site),
        "gas_peaker_cost_per_mwh": GAS_PEAKER_COST_PER_MWH,
        "diesel_cost_per_mwh": DIESEL_COST_PER_MWH,
        "grid_emission_factor": GRID_EMISSION_FACTOR,
    }


def find_smallest_battery(
    forecast: ForecastResponse,
    base_site: Site,
    evac_mw: float | None = None,
    flex_mw: float = 0.0,
) -> BreakEvenResult:
    """Find the smallest battery (MW and MWh) that removes the deficit entirely."""
    day = forecast.despatch_date
    rows = [b for b in forecast.blocks if b.timestamp.astimezone(IST).date().isoformat() == day]
    if not rows:
        rows = forecast.blocks[:BLOCKS_PER_DAY]

    p10 = np.array([b.p10 for b in rows], dtype=float)
    p90 = np.array([b.p90 for b in rows], dtype=float)
    schedule = synthesise_schedule(forecast, rows)
    deficit = np.maximum(schedule - p10, 0.0)
    surplus = np.maximum(p90 - schedule, 0.0)

    # Net deficit after any flexible demand
    net_deficit = np.maximum(deficit - flex_mw, 0.0)
    total_deficit_mwh = float(net_deficit.sum()) * BLOCK_HOURS

    if total_deficit_mwh < 0.1:
        return BreakEvenResult(
            feasible=True,
            minimum_power_mw=0.0,
            minimum_energy_mwh=0.0,
            message="No deficit exists under current operating conditions.",
        )

    peak_deficit_mw = float(np.max(net_deficit))
    total_surplus_mwh = float(surplus.sum()) * BLOCK_HOURS

    # Check total energy feasibility
    rte = BATTERY_ROUND_TRIP_EFFICIENCY
    if (total_surplus_mwh * rte) < (total_deficit_mwh * 0.7):
        return BreakEvenResult(
            feasible=False,
            minimum_power_mw=round(peak_deficit_mw, 0),
            minimum_energy_mwh=round(total_deficit_mwh, 0),
            message=f"Deficit ({total_deficit_mwh:.1f} MWh) exceeds daily surplus energy; battery alone cannot remove the entire deficit.",
        )

    # Binary search for minimum power & energy
    min_power = int(np.ceil(peak_deficit_mw / 5.0) * 5)
    best_p = float(min_power)
    best_e = float(min_power * 4)

    for p_cand in [min_power, min_power + 10, min_power + 25]:
        low_e = 5.0
        high_e = max(total_deficit_mwh * 2.5, 50.0)
        found_e = None
        for _ in range(16):
            mid_e = (low_e + high_e) / 2.0
            res = simulate_dispatch(
                forecast,
                site=base_site,
                battery_power_mw=float(p_cand),
                battery_energy_mwh=mid_e,
                battery_initial_soc_pct=50.0,
                flexible_demand_mw=flex_mw,
                evacuation_limit_mw=evac_mw,
            )
            if res.metrics.unserved_energy_mwh < 0.05:
                found_e = mid_e
                high_e = mid_e
            else:
                low_e = mid_e

        if found_e is not None:
            best_p = float(p_cand)
            best_e = float(int(np.ceil(found_e / 5.0) * 5))
            break

    return BreakEvenResult(
        feasible=True,
        minimum_power_mw=round(best_p, 0),
        minimum_energy_mwh=round(best_e, 0),
        message=f"Smallest battery that removes this deficit: {best_p:.0f} MW / {best_e:.0f} MWh",
    )


def compute_attribution(
    forecast: ForecastResponse,
    site: Site,
    base_defaults: dict[str, Any],
    req: SimulatorRequest,
) -> list[AttributionItem]:
    """Sequential attribution decomposing total delta into each operational lever."""
    # Step 0: Baseline
    r0 = simulate_dispatch(forecast, site=site)

    # Step 1: Battery changes
    r1 = simulate_dispatch(
        forecast,
        site=site,
        battery_power_mw=req.battery_power_mw,
        battery_energy_mwh=req.battery_energy_mwh,
        battery_initial_soc_pct=req.battery_initial_soc_pct,
        battery_rte_pct=req.battery_rte_pct,
    )

    # Step 2: Step 1 + Demand flexibility
    r2 = simulate_dispatch(
        forecast,
        site=site,
        battery_power_mw=req.battery_power_mw,
        battery_energy_mwh=req.battery_energy_mwh,
        battery_initial_soc_pct=req.battery_initial_soc_pct,
        battery_rte_pct=req.battery_rte_pct,
        flexible_demand_mw=req.flexible_demand_mw,
    )

    # Step 3: Step 2 + Grid limit
    r3 = simulate_dispatch(
        forecast,
        site=site,
        battery_power_mw=req.battery_power_mw,
        battery_energy_mwh=req.battery_energy_mwh,
        battery_initial_soc_pct=req.battery_initial_soc_pct,
        battery_rte_pct=req.battery_rte_pct,
        flexible_demand_mw=req.flexible_demand_mw,
        evacuation_limit_mw=req.evacuation_limit_mw,
    )

    # Step 4: Step 3 + Backup
    r4 = simulate_dispatch(
        forecast,
        site=site,
        battery_power_mw=req.battery_power_mw,
        battery_energy_mwh=req.battery_energy_mwh,
        battery_initial_soc_pct=req.battery_initial_soc_pct,
        battery_rte_pct=req.battery_rte_pct,
        flexible_demand_mw=req.flexible_demand_mw,
        evacuation_limit_mw=req.evacuation_limit_mw,
        backup_capacity_mw=req.backup_capacity_mw,
        backup_notice_hours=req.backup_notice_hours,
    )

    # Step 5: Step 4 + Economics (Full Scenario)
    r5 = simulate_dispatch(
        forecast,
        site=site,
        battery_power_mw=req.battery_power_mw,
        battery_energy_mwh=req.battery_energy_mwh,
        battery_initial_soc_pct=req.battery_initial_soc_pct,
        battery_rte_pct=req.battery_rte_pct,
        flexible_demand_mw=req.flexible_demand_mw,
        evacuation_limit_mw=req.evacuation_limit_mw,
        backup_capacity_mw=req.backup_capacity_mw,
        backup_notice_hours=req.backup_notice_hours,
        tariff_per_mwh=req.tariff_per_mwh,
        gas_peaker_cost_per_mwh=req.gas_peaker_cost_per_mwh,
        diesel_cost_per_mwh=req.diesel_cost_per_mwh,
        grid_emission_factor=req.grid_emission_factor,
    )

    def diff(curr: SimulationMetrics, prev: SimulationMetrics, label: str) -> AttributionItem:
        return AttributionItem(
            lever=label,
            unserved_delta_mwh=round(curr.unserved_energy_mwh - prev.unserved_energy_mwh, 1),
            curtailed_delta_mwh=round(curr.curtailed_energy_mwh - prev.curtailed_energy_mwh, 1),
            cost_delta_inr=round(curr.net_cost_inr - prev.net_cost_inr, 0),
            co2_delta_tonnes=round(curr.net_co2_tonnes - prev.net_co2_tonnes, 2),
        )

    return [
        diff(r1.metrics, r0.metrics, "Battery storage"),
        diff(r2.metrics, r1.metrics, "Demand flexibility"),
        diff(r3.metrics, r2.metrics, "Grid export limit"),
        diff(r4.metrics, r3.metrics, "Thermal backup"),
        diff(r5.metrics, r4.metrics, "Tariffs & Economics"),
    ]


def run_simulation(req: SimulatorRequest) -> SimulatorResponse:
    """Execute scenario simulation, compute deltas, attribution and break-even."""
    site = get_site(req.site_id)
    forecast = generate_forecast(site, horizon_hours=24)
    defaults = get_site_defaults(site)

    # 1. Baseline dispatch
    baseline_res = simulate_dispatch(forecast, site=site)

    # 2. Scenario dispatch
    scenario_res = simulate_dispatch(
        forecast,
        site=site,
        battery_power_mw=req.battery_power_mw,
        battery_energy_mwh=req.battery_energy_mwh,
        battery_initial_soc_pct=req.battery_initial_soc_pct,
        battery_rte_pct=req.battery_rte_pct,
        flexible_demand_mw=req.flexible_demand_mw,
        backup_capacity_mw=req.backup_capacity_mw,
        backup_notice_hours=req.backup_notice_hours,
        evacuation_limit_mw=req.evacuation_limit_mw,
        tariff_per_mwh=req.tariff_per_mwh,
        gas_peaker_cost_per_mwh=req.gas_peaker_cost_per_mwh,
        diesel_cost_per_mwh=req.diesel_cost_per_mwh,
        grid_emission_factor=req.grid_emission_factor,
    )

    # 3. Deltas: scenario minus baseline
    b_met = baseline_res.metrics
    s_met = scenario_res.metrics

    deltas = SimulationDeltas(
        served_energy_mwh=round(s_met.served_energy_mwh - b_met.served_energy_mwh, 1),
        curtailed_energy_mwh=round(s_met.curtailed_energy_mwh - b_met.curtailed_energy_mwh, 1),
        unserved_energy_mwh=round(s_met.unserved_energy_mwh - b_met.unserved_energy_mwh, 1),
        net_cost_inr=round(s_met.net_cost_inr - b_met.net_cost_inr, 0),
        net_co2_tonnes=round(s_met.net_co2_tonnes - b_met.net_co2_tonnes, 2),
    )

    # 4. Primary scenario message
    cost_save = -deltas.net_cost_inr
    unserved_save = -deltas.unserved_energy_mwh
    curtail_save = -deltas.curtailed_energy_mwh
    co2_save = -deltas.net_co2_tonnes

    if unserved_save > 0.1:
        primary_msg = f"Scenario removes {unserved_save:.1f} MWh of unserved energy deficit."
    elif cost_save > 5000:
        if cost_save >= 100_000:
            primary_msg = f"This scenario reduces dispatch cost by ₹{cost_save / 1e5:.1f} lakh."
        else:
            primary_msg = f"This scenario reduces dispatch cost by ₹{cost_save:,.0f}."
    elif curtail_save > 0.1:
        primary_msg = f"This scenario captures {curtail_save:.1f} MWh of would-be curtailed energy."
    elif co2_save > 0.1:
        primary_msg = f"This scenario reduces operational emissions by {co2_save:.1f} tCO₂."
    elif b_met.unserved_energy_mwh > 0 and s_met.unserved_energy_mwh > 0 and deltas.unserved_energy_mwh >= 0:
        primary_msg = "Additional battery capacity does not remove the remaining deficit under current grid constraints."
    else:
        primary_msg = "Scenario operating assumptions match baseline dispatch results."

    # 5. Break-even search
    break_even = find_smallest_battery(
        forecast,
        site,
        evac_mw=req.evacuation_limit_mw,
        flex_mw=req.flexible_demand_mw,
    )

    # 6. Attribution
    attrib = compute_attribution(forecast, site, defaults, req)

    # 7. Active scenario configuration dictionary
    scenario_cfg = {
        "site_id": req.site_id,
        "battery_power_mw": req.battery_power_mw if req.battery_power_mw is not None else defaults["battery_power_mw"],
        "battery_energy_mwh": req.battery_energy_mwh if req.battery_energy_mwh is not None else defaults["battery_energy_mwh"],
        "battery_initial_soc_pct": req.battery_initial_soc_pct if req.battery_initial_soc_pct is not None else defaults["battery_initial_soc_pct"],
        "battery_rte_pct": req.battery_rte_pct if req.battery_rte_pct is not None else defaults["battery_rte_pct"],
        "flexible_demand_mw": req.flexible_demand_mw,
        "backup_capacity_mw": req.backup_capacity_mw if req.backup_capacity_mw is not None else defaults["backup_capacity_mw"],
        "backup_notice_hours": req.backup_notice_hours,
        "evacuation_limit_mw": req.evacuation_limit_mw if req.evacuation_limit_mw is not None else defaults["evacuation_limit_mw"],
        "tariff_per_mwh": req.tariff_per_mwh if req.tariff_per_mwh is not None else defaults["tariff_per_mwh"],
        "gas_peaker_cost_per_mwh": req.gas_peaker_cost_per_mwh if req.gas_peaker_cost_per_mwh is not None else defaults["gas_peaker_cost_per_mwh"],
        "diesel_cost_per_mwh": req.diesel_cost_per_mwh if req.diesel_cost_per_mwh is not None else defaults["diesel_cost_per_mwh"],
        "grid_emission_factor": req.grid_emission_factor if req.grid_emission_factor is not None else defaults["grid_emission_factor"],
    }

    # 8. 96-block timeline comparison (baseline vs scenario)
    timeline = [
        SimulatorTimelineBlock(
            block=baseline_res.block_rows[i].block,
            label=baseline_res.block_rows[i].label,
            schedule_mw=round(float(baseline_res.schedule_mw[i]), 1),
            baseline_dispatch_mw=round(float(baseline_res.dispatched_mw[i]), 1),
            scenario_dispatch_mw=round(float(scenario_res.dispatched_mw[i]), 1),
            baseline_unserved_mw=round(float(baseline_res.unserved_mw[i]), 1),
            scenario_unserved_mw=round(float(scenario_res.unserved_mw[i]), 1),
            evacuation_limit_mw=round(float(scenario_res.evacuation_limit_mw), 1),
        )
        for i in range(len(baseline_res.block_rows))
    ]

    return SimulatorResponse(
        site_id=site.id,
        site_name=site.name,
        capacity_mw=site.capacity_mw,
        baseline_config=defaults,
        scenario_config=scenario_cfg,
        baseline=b_met,
        scenario=s_met,
        deltas=deltas,
        primary_message=primary_msg,
        break_even=break_even,
        attribution=attrib,
        actions=scenario_res.actions,
        timeline=timeline,
    )
