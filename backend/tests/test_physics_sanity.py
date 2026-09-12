"""Physics sanity — the checks that would have caught a 5.8× error.

The existing leak tests assert the physics never exceeds nameplate and is zero
at night. Both passed while the wind model was producing a 4.4% capacity factor
at Muppandal, a site that really achieves about 25%. Bounds checks cannot catch
a model that is merely, consistently, badly wrong.

So these tests assert against *known real-world values* rather than against
self-consistency. They are the difference between "the code runs" and "the code
is right".
"""

from __future__ import annotations

import numpy as np
import pytest

from app.core.physics import (
    air_density,
    hub_height_speed,
    observed_shear_exponent,
    power_curve_fraction,
)
from app.data.constants import TURBINE_CLASSES
from app.data.sites import get_site

# Manufacturer power curve for a Vestas V90-2.0 MW, an IEC Class I machine
# representative of the fleet at Muppandal and Jaisalmer. Values are the
# published output in kW at each hub-height wind speed, divided by 2000.
#
# This is the external reference. If the model drifts away from it, the model is
# wrong — not the table.
V90_REFERENCE = {
    4.0: 0.038,
    5.0: 0.096,
    6.0: 0.179,
    7.0: 0.292,
    8.0: 0.438,
    9.0: 0.602,
    10.0: 0.772,
    11.0: 0.899,
    12.0: 0.963,
}


@pytest.mark.parametrize("speed,expected", sorted(V90_REFERENCE.items()))
def test_power_curve_matches_a_real_turbine(speed: float, expected: float) -> None:
    """Within 4 percentage points of the published curve, everywhere.

    The failure this catches: `((v − v_in) / (v_r − v_in))³`, the textbook
    simplification, returns 0.050 at 7 m/s where the real machine delivers
    0.292. That is 5.8× low in the middle of the curve, which is where a
    turbine spends nearly all its operating hours, and it dragged Muppandal's
    annual capacity factor from ~25% down to 4.4%.
    """
    got = float(power_curve_fraction(np.array([speed]), "iec_i")[0])
    assert got == pytest.approx(expected, abs=0.04)


def test_power_curve_is_monotonic_below_rated() -> None:
    """More wind, more power — up to rated. No dips, no overshoot."""
    v = np.arange(0.0, 13.1, 0.25)
    p = power_curve_fraction(v, "iec_i")
    assert np.all(np.diff(p) >= -1e-9)
    assert p.max() <= 1.0 + 1e-9


def test_cut_out_is_a_cliff_not_a_ramp() -> None:
    """Crossing cut-out takes a farm from full output to zero.

    Smoothing this away would remove exactly the warning an operator needs
    before a storm.
    """
    cut_out = TURBINE_CLASSES["iec_i"]["cut_out"]
    just_below = float(power_curve_fraction(np.array([cut_out - 0.1]), "iec_i")[0])
    just_above = float(power_curve_fraction(np.array([cut_out + 0.1]), "iec_i")[0])
    assert just_below == pytest.approx(1.0)
    assert just_above == 0.0


def test_below_cut_in_is_zero() -> None:
    cut_in = TURBINE_CLASSES["iec_i"]["cut_in"]
    assert float(power_curve_fraction(np.array([cut_in - 0.1]), "iec_i")[0]) == 0.0


def test_low_wind_class_outperforms_high_wind_class_at_low_speed() -> None:
    """A Class III machine is built for weak wind and must beat Class I there.

    Same aerodynamics, bigger rotor per kW of generator — so at 6 m/s the
    low-wind turbine delivers a larger fraction of its rated power. A curve
    that ignored rated speed would return the same number for both and quietly
    misprice every low-wind site.
    """
    at_6 = {
        cls: float(power_curve_fraction(np.array([6.0]), cls)[0])
        for cls in ("iec_i", "iec_iii")
    }
    assert at_6["iec_iii"] > at_6["iec_i"]


# ═════════════════════════════════════════════════════════════════════════
# SHEAR
# ═════════════════════════════════════════════════════════════════════════


def test_observed_shear_recovers_a_known_exponent() -> None:
    """Solving α from two heights must invert the power law exactly."""
    alpha_true = 0.25
    v10 = np.array([5.0])
    v100 = v10 * (100.0 / 10.0) ** alpha_true
    assert float(observed_shear_exponent(v10, v100, 0.14)[0]) == pytest.approx(alpha_true)


def test_shear_falls_back_when_wind_is_calm() -> None:
    """Near-zero speeds make the log ratio numerical noise, and power cubes it."""
    got = observed_shear_exponent(np.array([0.0, 0.1]), np.array([0.2, 0.0]), 0.14)
    assert np.allclose(got, 0.14)


def test_hub_speed_sits_between_the_two_measured_heights() -> None:
    """An 80 m hub must read between the 10 m and 100 m values.

    Interpolation, not extrapolation — this is why the model reads down from
    100 m rather than up from 10 m.
    """
    site = get_site("muppandal")  # 80 m hub
    weather = {"wind_ms": np.array([4.4]), "wind_100_ms": np.array([6.9])}
    v_hub = float(hub_height_speed(site, weather)[0])
    assert 4.4 < v_hub < 6.9


def test_hub_speed_falls_back_without_the_100m_series() -> None:
    """The model must still work against a weather source that lacks 100 m."""
    site = get_site("jaisalmer")
    v = float(hub_height_speed(site, {"wind_ms": np.array([6.0])})[0])
    assert v > 6.0


# ═════════════════════════════════════════════════════════════════════════
# AIR DENSITY
# ═════════════════════════════════════════════════════════════════════════


def test_air_density_at_jaisalmer_in_summer() -> None:
    """225 m elevation at 45 °C is near 1.10 kg/m³, not the rated 1.225.

    Turbine power curves are rated at sea-level standard density. Ignoring the
    ~10% deficit overstates every Rajasthan summer afternoon, which is when the
    grid is most stressed.
    """
    rho = float(air_density(np.array([45.0]), 225.0)[0])
    assert 1.06 < rho < 1.14


def test_air_density_falls_with_temperature() -> None:
    cold, hot = air_density(np.array([10.0, 45.0]), 225.0)
    assert cold > hot
