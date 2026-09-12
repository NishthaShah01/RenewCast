"""The leak-free guarantee, enforced.

A target leak is the standard way a forecasting demo produces a fraudulent
accuracy figure. At 15-minute resolution `generation[t-1]` correlates about
0.99 with `generation[t]`, so a model handed that column scores superbly and
has learned persistence rather than forecasting. It then fails completely on
the thing it exists for — predicting block 90 at 06:00 — because the lag it
depends on has not happened yet.

These tests are cheap, run on every commit, and are the reason a hurried
feature addition at 3am cannot quietly invalidate every number on the accuracy
page.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.data.sites import get_site
from app.features.build import (
    FORBIDDEN_SUBSTRINGS,
    SOLAR_FEATURES,
    TARGET,
    WIND_FEATURES,
    build_weather_features,
    feature_matrix,
    features_for,
)

ALL_FEATURES = {"solar": SOLAR_FEATURES, "wind": WIND_FEATURES}


@pytest.mark.parametrize("technology", ["solar", "wind"])
def test_no_forbidden_feature_names(technology: str) -> None:
    """No feature name may hint at the target.

    A name check, not a correlation check, and deliberately so: it fails at
    the moment the column is declared rather than after a dataset has been
    built and a model trained on it.
    """
    offenders = [
        name
        for name in ALL_FEATURES[technology]
        for bad in FORBIDDEN_SUBSTRINGS
        if bad in name.lower()
    ]
    assert not offenders, f"{technology} features look target-derived: {offenders}"


@pytest.mark.parametrize("technology", ["solar", "wind"])
def test_target_is_not_a_feature(technology: str) -> None:
    assert TARGET not in ALL_FEATURES[technology]
    assert "actual_cf" not in ALL_FEATURES[technology]
    assert "actual_mw" not in ALL_FEATURES[technology]


@pytest.mark.parametrize("technology", ["solar", "wind"])
def test_feature_list_has_no_duplicates(technology: str) -> None:
    """Duplicates would silently change the column count the model binds to."""
    cols = ALL_FEATURES[technology]
    assert len(cols) == len(set(cols)), "duplicate feature names"


def test_physics_cf_is_present_in_both() -> None:
    """Stage A output is the anchor feature; without it Stage B has no base
    to correct and the residual target is meaningless."""
    assert "physics_cf" in SOLAR_FEATURES
    assert "physics_cf" in WIND_FEATURES


def test_lead_hours_is_present_in_both() -> None:
    """Lead time must be a feature, not an afterthought.

    Forecast error grows with lead. A model without this column produces one
    interval width for a 2-hour-ahead block and a 70-hour-ahead block, which
    makes the P10 bound either useless or dangerous depending on which end you
    are looking at.
    """
    assert "lead_hours" in SOLAR_FEATURES
    assert "lead_hours" in WIND_FEATURES


# ═════════════════════════════════════════════════════════════════════════
# BUILDER BEHAVIOUR ON SYNTHETIC INPUT — no network
# ═════════════════════════════════════════════════════════════════════════


def _fake_blocks(n: int = 96) -> pd.DataFrame:
    """One synthetic despatch day. Keeps the test offline and deterministic."""
    ts = pd.date_range("2026-03-15 00:00", periods=n, freq="15min", tz="UTC")
    hour = np.arange(n) * 0.25
    # A plausible bell of irradiance so the solar path exercises real numbers
    # rather than all zeros, which would hide a division bug.
    ghi = np.clip(900.0 * np.sin(np.pi * (hour - 6.0) / 12.0), 0.0, None)
    return pd.DataFrame(
        {
            "time_utc": ts,
            "despatch_date": [ts[0].date()] * n,
            "day_of_year": np.full(n, 74.0),
            "hour": hour,
            "block": np.arange(1, n + 1),
            "ghi": ghi,
            "dni": ghi * 0.8,
            "dhi": ghi * 0.2,
            "temp_c": 28.0 + 8.0 * np.sin(np.pi * (hour - 8.0) / 14.0),
            "humidity": np.full(n, 40.0),
            "pressure_pa": np.full(n, 99_000.0),
            "cloud_pct": np.full(n, 20.0),
            "precip_mm": np.zeros(n),
            "wind_ms": np.full(n, 6.0),
            "wind_100_ms": np.full(n, 8.5),
            "wind_dir": np.full(n, 250.0),
            "gust_ms": np.full(n, 9.0),
        }
    )


@pytest.mark.parametrize("site_id", ["bhadla", "jaisalmer"])
def test_feature_matrix_is_complete_and_finite(site_id: str) -> None:
    """Every declared feature must be produced, and none may be NaN or inf.

    LightGBM tolerates NaN, which is exactly the problem: a feature that is
    silently all-NaN trains without complaint and contributes nothing, so the
    model looks fine and is quietly weaker than it should be.
    """
    site = get_site(site_id)
    feat = build_weather_features(site, _fake_blocks(), lead_hours=12.0)
    x = feature_matrix(feat, site.technology)

    assert list(x.columns) == list(features_for(site.technology))
    assert len(x) == 96
    assert np.isfinite(x.to_numpy()).all(), "non-finite values in the feature matrix"


def test_feature_matrix_column_order_is_stable() -> None:
    """Order is part of the contract.

    A booster binds to column position as well as name, so a reordered frame at
    serving time produces confident nonsense rather than an error.
    """
    site = get_site("bhadla")
    feat = build_weather_features(site, _fake_blocks(), lead_hours=6.0)
    first = list(feature_matrix(feat, "solar").columns)
    second = list(feature_matrix(feat, "solar").columns)
    assert first == second == list(SOLAR_FEATURES)


def test_missing_feature_raises_rather_than_filling() -> None:
    """A dropped column must fail loudly.

    Filling it with zeros would let a broken serving path return plausible
    numbers, which is worse than a 500.
    """
    site = get_site("bhadla")
    feat = build_weather_features(site, _fake_blocks(), lead_hours=6.0)
    with pytest.raises(KeyError):
        feature_matrix(feat.drop(columns=["clear_sky_index"]), "solar")


def test_physics_is_zero_at_night_for_solar() -> None:
    """No irradiance, no output — and therefore no uncertainty band either."""
    site = get_site("bhadla")
    feat = build_weather_features(site, _fake_blocks(), lead_hours=1.0)
    night = feat[feat["ghi"] <= 0.0]
    assert len(night) > 0
    assert (night["physics_mw"] <= 0.001).all()


def test_physics_respects_nameplate() -> None:
    """Stage A may never exceed the AC rating, whatever the irradiance.

    This is the inverter clipping limit. A model that breaches it would tell an
    operator to schedule power the plant physically cannot export.
    """
    for site_id in ("bhadla", "pavagada", "charanka", "muppandal", "jaisalmer"):
        site = get_site(site_id)
        feat = build_weather_features(site, _fake_blocks(), lead_hours=1.0)
        assert feat["physics_mw"].max() <= site.capacity_mw + 1e-6
        assert feat["physics_mw"].min() >= -1e-9
