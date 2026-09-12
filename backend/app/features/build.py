"""Feature construction.

## The one rule

**No feature may be derived from the target.** No lag of generation, no rolling
mean of output, no "yesterday's peak". Every column here comes from weather,
calendar, plant geometry, or the physics model — all of which are available at
forecast time for every block in the horizon.

This is not fussiness. A target lag is the single most common way a forecasting
demo produces a fraudulent accuracy number: `y_lag_1` correlates ~0.99 with `y`
at 15-minute resolution, so the model scores beautifully and has learned
persistence rather than forecasting. It then collapses the moment it has to
predict block 90 at 06:00, because the lag it depends on does not exist yet.

`tests/test_no_leak.py` enforces this by inspecting the feature names, so the
rule survives someone adding a column in a hurry at 3am.

## Why the target is a capacity-factor *residual*

Stage B predicts `actual_cf - physics_cf`, not MW and not CF.

Three consequences, all of them wanted:

  scale-free   Bhadla at 2245 MW and Charanka at 790 MW become comparable, so
               one model can pool all the solar sites and see 3x the data.
  small target The residual is centred near zero with a narrow spread, which
               is far easier to fit than a quantity spanning 0–2245.
  interpretable"physics said 1800 MW, the model shaves 6%" is a sentence an
               operator can check. An end-to-end black box is not.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core import astronomy
from app.core.physics import physics_power_mw
from app.data.sites import Site
from app.services.weather import weather_arrays

# ═════════════════════════════════════════════════════════════════════════
# FEATURE LISTS — the train/serve contract
# ═════════════════════════════════════════════════════════════════════════

# Shared by both technologies.
_COMMON = (
    "physics_cf",
    "lead_hours",
    "temp_c",
    "humidity",
    "cloud_pct",
    "precip_mm",
    "pressure_pa",
    "hour_sin",
    "hour_cos",
    "doy_sin",
    "doy_cos",
)

SOLAR_FEATURES: tuple[str, ...] = _COMMON + (
    "ghi",
    "dni",
    "dhi",
    "clear_sky_ghi",
    "clear_sky_index",
    "solar_elevation",
    "air_mass",
    "diffuse_fraction",
    "ghi_ramp_1h",
    "cloud_ramp_1h",
    "clear_sky_index_std_1h",
    "wind_ms",
)

WIND_FEATURES: tuple[str, ...] = _COMMON + (
    "wind_ms",
    "wind_100_ms",
    "gust_ms",
    "wind_dir_sin",
    "wind_dir_cos",
    "shear_ratio",
    "turbulence_intensity",
    "air_density",
    "wind_ramp_1h",
    "wind_std_1h",
    "wind_cubed",
)

TARGET = "cf_residual"

# Anything matching these is a leak by construction. Checked by the test suite
# against the feature lists above.
FORBIDDEN_SUBSTRINGS: tuple[str, ...] = (
    "actual",
    "target",
    "observed",
    "generation_lag",
    "mw_lag",
    "y_lag",
    "cf_lag",
    "persistence",
)


def features_for(technology: str) -> tuple[str, ...]:
    return SOLAR_FEATURES if technology == "solar" else WIND_FEATURES


# ═════════════════════════════════════════════════════════════════════════
# BUILDERS
# ═════════════════════════════════════════════════════════════════════════


def _cyclical(values: pd.Series, period: float) -> tuple[pd.Series, pd.Series]:
    """Encode a cyclical quantity as a sine/cosine pair.

    Hour 23 and hour 0 are adjacent in time but maximally distant as numbers.
    A tree can learn around that with enough splits; giving it the circle
    directly costs one extra column and saves it the trouble.
    """
    angle = 2.0 * np.pi * values / period
    return np.sin(angle), np.cos(angle)


def _ramp(series: pd.Series, blocks: int = 4) -> pd.Series:
    """Change over the preceding `blocks` blocks — 4 blocks is one hour.

    A *weather* difference, not a target difference, so it is legal: the whole
    forecast horizon is known at prediction time, which means this is
    computable for block 288 at the moment of issue.

    Ramps carry information levels do not. 400 W/m² on the way up is a clearing
    morning; 400 W/m² on the way down is arriving cloud, and the second has far
    wider uncertainty.
    """
    return series.diff(blocks).fillna(0.0)


def build_weather_features(
    site: Site,
    blocks: pd.DataFrame,
    lead_hours: float | np.ndarray,
) -> pd.DataFrame:
    """Full feature frame for one site over a block-indexed weather frame.

    `blocks` must already have been through `weather.to_blocks` and
    `weather.add_time_features`. `lead_hours` is scalar for a training slice of
    fixed lead, or an array for a live forecast where lead grows across the
    horizon.
    """
    df = blocks.copy()
    arrays = weather_arrays(df)

    # ── Stage A, the anchor feature ───────────────────────────────────────
    physics_mw = physics_power_mw(site, arrays)
    df["physics_mw"] = physics_mw
    df["physics_cf"] = physics_mw / site.capacity_mw

    df["lead_hours"] = lead_hours

    # ── Calendar, as circles ──────────────────────────────────────────────
    df["hour_sin"], df["hour_cos"] = _cyclical(df["hour"], 24.0)
    df["doy_sin"], df["doy_cos"] = _cyclical(df["day_of_year"], 365.25)

    if site.technology == "solar":
        zenith, _, elevation = astronomy.solar_position(
            site.latitude, site.longitude, arrays["day_of_year"], arrays["hour"]
        )
        df["solar_elevation"] = elevation
        df["clear_sky_ghi"] = astronomy.clear_sky_ghi(zenith)
        df["clear_sky_index"] = astronomy.clear_sky_index(arrays["ghi"], zenith)
        # Capped: air mass is infinite below the horizon, and LightGBM handles
        # a large finite number fine but inf poisons any later scaling.
        df["air_mass"] = np.minimum(astronomy.air_mass(zenith), 40.0)

        # Diffuse fraction separates haze from cloud. A hazy Indo-Gangetic sky
        # has high diffuse and moderate GHI; broken cloud has similar mean GHI
        # but swings violently. The plant responds very differently.
        total = df["ghi"].to_numpy()
        df["diffuse_fraction"] = np.divide(
            df["dhi"].to_numpy(),
            total,
            out=np.zeros_like(total),
            where=total > 10.0,
        )

        df["ghi_ramp_1h"] = _ramp(df["ghi"])
        df["cloud_ramp_1h"] = _ramp(df["cloud_pct"])
        # Variability of the clear-sky index over the past hour: the cleanest
        # available proxy for broken cloud, which is what makes a solar
        # forecast uncertain rather than merely low.
        df["clear_sky_index_std_1h"] = (
            df["clear_sky_index"].rolling(4, min_periods=1).std().fillna(0.0)
        )
    else:
        from app.core.physics import air_density

        df["wind_dir_sin"], df["wind_dir_cos"] = _cyclical(df["wind_dir"], 360.0)

        # Raw 100 m / 10 m speed ratio. Stage A already extrapolates to hub
        # height using the exponent implied by this ratio, so it is not new
        # information about speed — it is information about *stability*. A high
        # ratio means a decoupled nocturnal boundary layer, where the wind aloft
        # is steady and the 10 m reading says little; a low one means a mixed
        # convective afternoon with more turbulence at hub height. Those two
        # regimes have different forecast error even at identical hub speed,
        # which is what the model can learn from here.
        df["shear_ratio"] = df["wind_100_ms"] / df["wind_ms"].clip(lower=0.5)

        # Gust factor. Turbulent air costs a turbine output at the same mean
        # speed, because the power curve is convex and pitch control lags.
        df["turbulence_intensity"] = (df["gust_ms"] - df["wind_ms"]) / df["wind_ms"].clip(
            lower=0.5
        )

        df["air_density"] = air_density(
            arrays["temp_c"], site.elevation_m, arrays.get("pressure_pa")
        )
        df["wind_ramp_1h"] = _ramp(df["wind_ms"])
        df["wind_std_1h"] = df["wind_ms"].rolling(4, min_periods=1).std().fillna(0.0)
        # Power is proportional to v³. Handing the tree the cube saves it
        # approximating a smooth curve with a staircase of splits.
        df["wind_cubed"] = df["wind_ms"] ** 3

    return df


def feature_matrix(df: pd.DataFrame, technology: str) -> pd.DataFrame:
    """Select the model's columns in a fixed order, NaNs filled.

    Column order is part of the contract: LightGBM binds to position as well as
    name, so a reordered frame at serving time would silently produce garbage.
    """
    cols = features_for(technology)
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise KeyError(f"Feature frame is missing {missing}")
    return df[list(cols)].astype(float).fillna(0.0)
