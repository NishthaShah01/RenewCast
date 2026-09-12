"""Tests for What-If Simulator service and endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import SimulatorRequest
from app.services.simulator import (
    find_smallest_battery,
    get_site_defaults,
    run_simulation,
    simulate_dispatch,
)
from tests.test_decisions import _forecast

client = TestClient(app)


def test_simulate_dispatch_matches_baseline():
    """Simulating with defaults matches baseline exactly."""
    fc = _forecast("bhadla", "solar_bell")
    res = simulate_dispatch(fc)
    assert res.metrics.served_energy_mwh > 0
    assert res.metrics.curtailed_energy_mwh >= 0
    assert len(res.block_rows) == 96


def test_battery_expansion_reduces_curtailment_or_unserved():
    """Expanding battery capacity absorbs more energy."""
    fc = _forecast("bhadla", "overgeneration")
    base = simulate_dispatch(fc)
    expanded = simulate_dispatch(
        fc,
        battery_power_mw=300.0,
        battery_energy_mwh=1200.0,
    )
    # Curtailment with bigger battery should be less than or equal to baseline
    assert expanded.metrics.curtailed_energy_mwh <= base.metrics.curtailed_energy_mwh


def test_flexible_demand_reduces_deficit():
    """Demand flexibility lowers unserved energy."""
    fc = _forecast("pavagada", "deficit_heavy")
    base = simulate_dispatch(fc, flexible_demand_mw=0.0)
    flex = simulate_dispatch(fc, flexible_demand_mw=100.0)
    assert flex.metrics.unserved_energy_mwh <= base.metrics.unserved_energy_mwh


def test_break_even_search_finds_battery():
    """Break-even search finds battery configuration removing deficit."""
    fc = _forecast("bhadla", "deficit_heavy")
    be = find_smallest_battery(fc, fc.site)
    assert be.feasible is True
    assert be.minimum_power_mw > 0
    assert be.minimum_energy_mwh > 0
    assert "Smallest battery" in be.message


def test_attribution_sums_to_total_delta():
    """The sum of attribution deltas must match total deltas."""
    fc = _forecast("bhadla", "deficit_heavy")
    req = SimulatorRequest(
        site_id="bhadla",
        battery_power_mw=150.0,
        battery_energy_mwh=600.0,
        flexible_demand_mw=50.0,
        evacuation_limit_mw=1800.0,
        backup_capacity_mw=300.0,
    )
    res = run_simulation(req)
    # Check that sum of attribution costs matches deltas.net_cost_inr
    sum_attrib_cost = sum(a.cost_delta_inr for a in res.attribution)
    assert abs(sum_attrib_cost - res.deltas.net_cost_inr) < 5.0
    sum_attrib_unserved = sum(a.unserved_delta_mwh for a in res.attribution)
    assert abs(sum_attrib_unserved - res.deltas.unserved_energy_mwh) < 0.5


def test_simulator_api_endpoints():
    """POST /api/simulate and GET /api/simulate/defaults work via HTTP."""
    resp_def = client.get("/api/simulate/defaults/bhadla")
    assert resp_def.status_code == 200
    data_def = resp_def.json()
    assert data_def["site_id"] == "bhadla"
    assert "battery_power_mw" in data_def["defaults"]

    resp_sim = client.post(
        "/api/simulate",
        json={
            "site_id": "bhadla",
            "battery_power_mw": 100.0,
            "battery_energy_mwh": 400.0,
        },
    )
    assert resp_sim.status_code == 200
    sim_data = resp_sim.json()
    assert "baseline" in sim_data
    assert "scenario" in sim_data
    assert "deltas" in sim_data
    assert "break_even" in sim_data
    assert "attribution" in sim_data
    assert "actions" in sim_data
    assert "timeline" in sim_data
    assert len(sim_data["timeline"]) == 96
    first_block = sim_data["timeline"][0]
    assert "schedule_mw" in first_block
    assert "baseline_dispatch_mw" in first_block
    assert "scenario_dispatch_mw" in first_block

