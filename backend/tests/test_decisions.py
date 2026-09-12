"""Invariants of the decisions layer.

The failures these guard against share a property: they produce numbers that
look entirely reasonable. A battery that discharges energy it never stored, a
block counted twice in an energy total, an MWh figure that is four times too
large because the quarter-hour factor was dropped — none of these raise an
exception, and none of them look wrong on a chart. They are caught here or not
at all.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from app.core.timeblocks import IST, block_label
from app.data.constants import BATTERY_ROUND_TRIP_EFFICIENCY, BLOCKS_PER_DAY
from app.data.sites import get_site
from app.schemas import ForecastBlock, ForecastResponse
from app.services.decisions import (
    BLOCK_HOURS,
    DECLARATION_HAIRCUT,
    build_decisions,
    synthesise_schedule,
)


def _forecast(site_id: str, shape: str = "solar_bell") -> ForecastResponse:
    """A full 96-block forecast day, offline and deterministic.

    Built by hand rather than by calling the live pipeline so the tests do not
    depend on the weather API, on trained models, or on what the sky happens to
    be doing at the moment they run.
    """
    site = get_site(site_id)
    day = datetime(2026, 3, 15, 0, 0, tzinfo=IST)
    cap = site.capacity_mw

    idx = np.arange(BLOCKS_PER_DAY)
    hours = idx * 0.25

    if shape == "solar_bell":
        p50 = np.clip(cap * 0.85 * np.sin(np.pi * (hours - 6.0) / 12.0), 0.0, None)
    elif shape == "flat_high":
        # Deliberately above the evacuation limit, to force curtailment.
        p50 = np.full(BLOCKS_PER_DAY, cap * 0.95)
    else:
        p50 = np.full(BLOCKS_PER_DAY, cap * 0.30)

    spread = 0.06 * cap
    blocks = [
        ForecastBlock(
            block=int(i + 1),
            timestamp=day + timedelta(minutes=15 * int(i)),
            label=block_label(int(i + 1)),
            lead_hours=float(hours[i]),
            p10=float(max(p50[i] - spread, 0.0)),
            p50=float(p50[i]),
            p90=float(min(p50[i] + spread, cap)),
            physics_mw=float(p50[i]),
            capacity_factor=float(p50[i] / cap),
            is_daylight=bool(p50[i] > 0),
        )
        for i in idx
    ]

    return ForecastResponse(
        site=site,
        issued_at=day + timedelta(hours=6),
        despatch_date="2026-03-15",
        horizon_hours=24,
        blocks=blocks,
        current_block=25,
        revision_horizon_block=31,
        weather_source="test",
        model_version="test",
    )


# ═════════════════════════════════════════════════════════════════════════
# THE BLOCK SPINE
# ═════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("site_id", ["bhadla", "charanka", "jaisalmer"])
def test_exactly_one_row_per_block(site_id: str) -> None:
    """96 rows, numbered 1..96, no duplicates.

    The live forecast window starts at block 1 of today and runs forward from
    now, so a 24-hour horizon crosses midnight and yields ~118 blocks with the
    numbers 1-22 appearing twice. Every consumer keyed on block index would
    then see two rows claiming to be block 7.
    """
    d = build_decisions(_forecast(site_id))
    numbers = [b.block for b in d.blocks]

    assert len(numbers) == BLOCKS_PER_DAY
    assert sorted(numbers) == list(range(1, BLOCKS_PER_DAY + 1))


def test_locked_flag_matches_revision_horizon() -> None:
    """A block is locked exactly when no revision issued now can reach it."""
    d = build_decisions(_forecast("bhadla"))
    for b in d.blocks:
        assert b.locked == (b.block < d.revision_horizon_block)


# ═════════════════════════════════════════════════════════════════════════
# QUANTILE ASSIGNMENT — the core of the design
# ═════════════════════════════════════════════════════════════════════════


def test_deficit_is_measured_against_p10_not_p50() -> None:
    """Shortfall is the credible worst case, not the central one.

    Judging a deficit against P50 leaves an operator under-covered every other
    day by construction. This test pins the asymmetry down so a later
    'simplification' to P50 fails loudly.
    """
    d = build_decisions(_forecast("bhadla"))
    for b in d.blocks:
        assert b.deficit_mw == pytest.approx(max(b.schedule_mw - b.p10, 0.0), abs=0.11)


def test_surplus_and_curtailment_are_measured_against_p90() -> None:
    d = build_decisions(_forecast("bhadla"))
    evac = d.site.evacuation_limit_mw
    for b in d.blocks:
        assert b.surplus_mw == pytest.approx(max(b.p90 - b.schedule_mw, 0.0), abs=0.11)
        assert b.curtailment_mw == pytest.approx(max(b.p90 - evac, 0.0), abs=0.11)


def test_curtailment_appears_when_p90_exceeds_evacuation() -> None:
    """A plant generating above its export limit must be told so.

    Charanka is 790 MW nameplate against a 750 MW evacuation limit, so a
    high-output day genuinely cannot be exported in full — the constraint is
    real for this site, not contrived for the test.
    """
    d = build_decisions(_forecast("charanka", shape="flat_high"))
    assert d.curtailment_energy_mwh > 0.0
    assert any(b.curtailment_mw > 0 for b in d.blocks)


# ═════════════════════════════════════════════════════════════════════════
# THE SCHEDULE CURVE
# ═════════════════════════════════════════════════════════════════════════


def test_schedule_is_conservative_on_average() -> None:
    """A declaration sits below the central estimate, not above it.

    With the haircut removed the declared curve sits above P10 almost
    everywhere, every block reads as a shortfall, and the engine recommends
    diesel at a solar plant at noon.
    """
    f = _forecast("bhadla")
    schedule = synthesise_schedule(f, f.blocks)
    p50 = np.array([b.p50 for b in f.blocks])

    daylight = p50 > 0.01 * f.site.capacity_mw
    assert schedule[daylight].sum() < p50[daylight].sum()
    assert schedule.sum() / p50.sum() == pytest.approx(DECLARATION_HAIRCUT, abs=0.08)


def test_schedule_is_stable_across_calls() -> None:
    """Same despatch day, same curve.

    The drift is seeded from the date precisely so a page refresh does not
    reshuffle the schedule. A number that changes when you reload is a number
    nobody trusts.
    """
    f = _forecast("bhadla")
    assert np.allclose(synthesise_schedule(f, f.blocks), synthesise_schedule(f, f.blocks))


def test_schedule_never_exceeds_nameplate() -> None:
    f = _forecast("charanka", shape="flat_high")
    schedule = synthesise_schedule(f, f.blocks)
    assert schedule.max() <= f.site.capacity_mw + 1e-6
    assert schedule.min() >= 0.0


# ═════════════════════════════════════════════════════════════════════════
# BATTERY PHYSICS
# ═════════════════════════════════════════════════════════════════════════


def test_battery_never_exceeds_its_power_rating() -> None:
    d = build_decisions(_forecast("bhadla", shape="flat_high"))
    site = d.site
    assert site.battery is not None

    for a in d.actions:
        if a.action in ("battery_charge", "battery_discharge"):
            assert a.magnitude_mw <= site.battery.power_mw + 1e-6


def test_battery_discharges_no_more_than_it_stored() -> None:
    """Energy conservation across the day, round-trip losses included.

    A greedy walk that forgot to decrement state of charge would happily
    recommend discharging a four-hour battery for twelve hours. The plan would
    look decisive and be impossible.
    """
    d = build_decisions(_forecast("bhadla"))
    site = d.site
    assert site.battery is not None

    charged = sum(a.energy_mwh for a in d.actions if a.action == "battery_charge")
    discharged = sum(a.energy_mwh for a in d.actions if a.action == "battery_discharge")

    # Starts half full, so the ceiling is what it stored plus the initial
    # reserve — not merely what it stored.
    available = charged * BATTERY_ROUND_TRIP_EFFICIENCY + 0.5 * site.battery.energy_mwh
    assert discharged <= available + 1e-6


def test_site_without_storage_gets_no_battery_actions() -> None:
    """Charanka has no battery. It must never be told to charge one."""
    d = build_decisions(_forecast("charanka", shape="flat_high"))
    assert d.site.battery is None
    assert not [a for a in d.actions if a.action.startswith("battery_")]


# ═════════════════════════════════════════════════════════════════════════
# ENERGY ARITHMETIC
# ═════════════════════════════════════════════════════════════════════════


def test_block_energy_uses_the_quarter_hour_factor() -> None:
    """MWh is MW ÷ 4. Dropping it yields totals four times too large.

    Those totals stay plausible enough to survive review, which is exactly why
    this is asserted rather than eyeballed.
    """
    assert BLOCK_HOURS == pytest.approx(0.25)

    d = build_decisions(_forecast("bhadla"))
    expected = sum(b.deficit_mw for b in d.blocks) * BLOCK_HOURS
    assert d.deficit_energy_mwh == pytest.approx(expected, rel=1e-3)


def test_action_energy_matches_its_span() -> None:
    """Reported energy must equal magnitude × duration for every action."""
    d = build_decisions(_forecast("bhadla"))
    for a in d.actions:
        span_blocks = a.block_end - a.block_start + 1
        assert a.energy_mwh == pytest.approx(
            a.magnitude_mw * span_blocks * BLOCK_HOURS, rel=0.02
        )


# ═════════════════════════════════════════════════════════════════════════
# ACTION GROUPING AND MERIT ORDER
# ═════════════════════════════════════════════════════════════════════════


def test_actions_are_contiguous_and_ordered() -> None:
    d = build_decisions(_forecast("bhadla"))
    for a in d.actions:
        assert 1 <= a.block_start <= a.block_end <= BLOCKS_PER_DAY


def test_actionable_actions_are_listed_first() -> None:
    """An operator reads top-down and should meet what they can still change."""
    d = build_decisions(_forecast("pavagada"))
    flags = [a.actionable for a in d.actions]
    assert flags == sorted(flags, reverse=True)


def test_diesel_is_never_chosen_before_gas() -> None:
    """Merit order holds: diesel only covers what gas could not.

    Diesel is both the most expensive and the dirtiest option in the stack, so
    a plan that reaches for it while gas headroom remains is not a plan, it is
    a bug with a price attached.
    """
    d = build_decisions(_forecast("muppandal", shape="flat_low"))
    diesel_blocks = {
        b for a in d.actions if a.action == "diesel" for b in range(a.block_start, a.block_end + 1)
    }
    gas_blocks = {
        b
        for a in d.actions
        if a.action == "gas_peaker"
        for b in range(a.block_start, a.block_end + 1)
    }
    assert diesel_blocks <= gas_blocks


def test_battery_charging_beats_curtailment_on_cost() -> None:
    """Storing surplus must price better than throwing it away.

    If it did not, the merit order would be backwards and the recommendation
    engine would be advising the expensive option with a confident face.
    """
    d = build_decisions(_forecast("bhadla", shape="flat_high"))
    charge = [a for a in d.actions if a.action == "battery_charge"]
    curtail = [a for a in d.actions if a.action == "curtail"]

    if charge and curtail:
        charge_rate = sum(a.cost_inr for a in charge) / sum(a.energy_mwh for a in charge)
        curtail_rate = sum(a.cost_inr for a in curtail) / sum(a.energy_mwh for a in curtail)
        assert charge_rate < curtail_rate


# ═════════════════════════════════════════════════════════════════════════
# HONESTY OF THE PAYLOAD
# ═════════════════════════════════════════════════════════════════════════


def test_schedule_basis_declares_itself_simulated() -> None:
    """The UI must never be able to present this as a filed schedule."""
    d = build_decisions(_forecast("bhadla"))
    assert "imulated" in d.schedule_basis
    assert "ot a filed schedule" in d.schedule_basis


def test_headline_is_present_and_specific() -> None:
    for site_id in ("bhadla", "pavagada", "charanka", "muppandal", "jaisalmer"):
        d = build_decisions(_forecast(site_id))
        assert d.headline
        assert not d.headline.endswith("..")
