"""Open-Meteo weather client.

Two endpoints, one shape of data:

  api.open-meteo.com                 live forecast, for serving
  historical-forecast-api.open-meteo  archived forecasts, for training

No API key. No account. The service is free for non-commercial use and
rate-limited generously enough that a 5-site, 2-year pull is a few dozen
requests.

## Why archived *forecasts* and not reanalysis

The obvious training source is reanalysis (ERA5): the best retrospective
estimate of what the weather actually was. It is the wrong choice, and using it
is the most common way a forecasting project quietly cheats.

At serving time the model sees a *forecast* — which is wrong, systematically,
in ways that worsen with lead time. A model trained on reanalysis has only ever
seen near-perfect weather and has no idea that a 3-day-ahead GHI number tends
to run optimistic. It will look excellent in validation and mediocre in
production, and the gap will be invisible in your metrics.

The archived-forecast API returns what was actually predicted at the time. The
`_previous_dayN` variants return the run issued N days earlier, which is how we
obtain real lead-time structure: at Bhadla on 2025-06-01 the 3-day-ahead run
predicted 898 W/m² for a block the short-lead run put at 757 — a 19% optimistic
bias that a cloud field arriving late would have caused. That bias is the signal
`lead_hours` lets the model learn, and it is measured, not assumed.

## Why hourly, then interpolated

Open-Meteo offers `minutely_15`, but outside central Europe it is interpolated
from the hourly fields anyway. Requesting it would add a second code path for no
new information. Instead we always fetch hourly and always run the same
`to_blocks` interpolation — training and serving traverse identical code, which
is the only reliable defence against train/serve skew.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import httpx
import numpy as np
import pandas as pd

from app.core.timeblocks import IST
from app.data.sites import Site
from app.store import weather_cache

log = logging.getLogger("renewcast.weather")

LIVE_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"

# The variables we request, in a fixed order so cache keys are stable.
# `cloud_cover_low` is deliberately absent: its `_previous_dayN` series comes
# back all-null, and a feature that exists at serving time but not at training
# time is worse than no feature.
WEATHER_VARS: tuple[str, ...] = (
    "temperature_2m",
    "relative_humidity_2m",
    "surface_pressure",
    "cloud_cover",
    "precipitation",
    "shortwave_radiation",
    "direct_normal_irradiance",
    "diffuse_radiation",
    "wind_speed_10m",
    "wind_speed_100m",
    "wind_direction_10m",
    "wind_gusts_10m",
)

# Open-Meteo's names mapped to ours. Short names because they appear in every
# feature vector and every debug print.
RENAME: dict[str, str] = {
    "temperature_2m": "temp_c",
    "relative_humidity_2m": "humidity",
    "surface_pressure": "pressure_hpa",
    "cloud_cover": "cloud_pct",
    "precipitation": "precip_mm",
    "shortwave_radiation": "ghi",
    "direct_normal_irradiance": "dni",
    "diffuse_radiation": "dhi",
    "wind_speed_10m": "wind_ms",
    "wind_speed_100m": "wind_100_ms",
    "wind_direction_10m": "wind_dir",
    "wind_gusts_10m": "gust_ms",
}

REQUEST_TIMEOUT_S = 45.0


class WeatherUnavailable(RuntimeError):
    """The weather service could not be reached or returned an error.

    Carries a message written for display: the UI shows it verbatim next to a
    degraded-mode banner rather than a generic failure.
    """


def _request(url: str, params: dict[str, object]) -> dict:
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_S) as client:
            r = client.get(url, params=params)
            r.raise_for_status()
            payload = r.json()
    except httpx.HTTPStatusError as exc:
        # Open-Meteo puts a human-readable explanation in `reason`.
        reason = ""
        try:
            reason = exc.response.json().get("reason", "")
        except Exception:
            reason = exc.response.text[:200]
        raise WeatherUnavailable(
            f"Weather service returned {exc.response.status_code}: {reason}"
        ) from exc
    except httpx.HTTPError as exc:
        raise WeatherUnavailable(f"Could not reach the weather service: {exc}") from exc

    if payload.get("error"):
        raise WeatherUnavailable(f"Weather service error: {payload.get('reason', 'unknown')}")
    return payload


def _to_frame(payload: dict, lead_days: int) -> pd.DataFrame:
    """Normalise an Open-Meteo hourly payload into our column names.

    The `_previous_dayN` suffix is stripped, so a frame from lead 0 and a frame
    from lead 3 are column-identical and the caller never branches on lead.
    """
    hourly = payload["hourly"]
    suffix = f"_previous_day{lead_days}" if lead_days else ""

    data: dict[str, object] = {"time": pd.to_datetime(hourly["time"], utc=True)}
    for src, dst in RENAME.items():
        key = f"{src}{suffix}"
        if key not in hourly:
            raise WeatherUnavailable(f"Weather service omitted '{key}'.")
        data[dst] = pd.to_numeric(pd.Series(hourly[key]), errors="coerce")

    df = pd.DataFrame(data)

    # hPa to Pa: the air-density calculation is in SI, and a 100x error here
    # would produce plausible-looking but badly wrong wind power.
    df["pressure_pa"] = df["pressure_hpa"] * 100.0
    df = df.drop(columns=["pressure_hpa"])

    df["reported_elevation_m"] = payload.get("elevation", np.nan)
    return df


def fetch_live(site: Site, horizon_hours: int = 72) -> pd.DataFrame:
    """Current forecast for a site, hourly, UTC-indexed.

    Cached for `settings.weather_cache_ttl_min`. The cache is not an
    optimisation detail — it is what keeps a live demo responsive when several
    people load the page at once, and what keeps us inside the free tier.
    """
    # Round the horizon up to whole days: the API is day-granular, and asking
    # for 72 hours mid-afternoon needs 4 calendar days of coverage.
    days = min(16, horizon_hours // 24 + 2)
    params = {
        "latitude": site.latitude,
        "longitude": site.longitude,
        "hourly": ",".join(WEATHER_VARS),
        "wind_speed_unit": "ms",
        "timezone": "GMT",
        "forecast_days": days,
        "past_days": 1,
    }

    cache_key = f"live_{site.id}_{days}"
    cached = weather_cache.get(cache_key)
    if cached is not None:
        return _to_frame(cached, lead_days=0)

    payload = _request(LIVE_URL, params)
    weather_cache.set(cache_key, payload)
    return _to_frame(payload, lead_days=0)


def fetch_archive(
    site: Site,
    start: date,
    end: date,
    lead_days: int = 0,
) -> pd.DataFrame:
    """Archived forecast for a past date range.

    `lead_days=0` is the shortest-lead (most accurate) archived run — the best
    available proxy for what the weather actually did. `lead_days=1..3` are the
    runs issued that many days earlier, carrying real forecast error.

    Not cached through `weather_cache`: the dataset builder writes parquet and
    is re-run rarely, so a second cache layer would only consume disk.
    """
    suffix = f"_previous_day{lead_days}" if lead_days else ""
    params = {
        "latitude": site.latitude,
        "longitude": site.longitude,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(f"{v}{suffix}" for v in WEATHER_VARS),
        "wind_speed_unit": "ms",
        "timezone": "GMT",
    }
    payload = _request(ARCHIVE_URL, params)
    return _to_frame(payload, lead_days=lead_days)


# ═════════════════════════════════════════════════════════════════════════
# HOURLY → 96 BLOCKS
# ═════════════════════════════════════════════════════════════════════════

# Columns where linear interpolation is the right choice. Irradiance is
# included: over 15 minutes the sun's geometry dominates and a straight line
# between hourly values is a better estimate than a step.
_INTERPOLATE = (
    "temp_c",
    "humidity",
    "pressure_pa",
    "cloud_pct",
    "ghi",
    "dni",
    "dhi",
    "wind_ms",
    "wind_100_ms",
    "gust_ms",
)


def to_blocks(hourly: pd.DataFrame) -> pd.DataFrame:
    """Resample hourly weather onto the 15-minute despatch grid.

    Two column groups are handled differently, and conflating them is a real
    error rather than a nicety:

      continuous fields   linearly interpolated
      wind direction      interpolated as a unit vector, then re-angled
      precipitation       divided by 4, because it is an accumulation

    Wind direction is the subtle one. Averaging 350° and 10° arithmetically
    gives 180° — a southerly reading for two northerly observations. Converting
    to sine and cosine, interpolating those, and taking the arctangent gives
    0°, which is correct.
    """
    df = hourly.sort_values("time").set_index("time")

    target = pd.date_range(
        start=df.index[0],
        end=df.index[-1],
        freq="15min",
        tz="UTC",
    )

    out = pd.DataFrame(index=target)

    for col in _INTERPOLATE:
        if col in df.columns:
            out[col] = df[col].reindex(df.index.union(target)).interpolate("time").reindex(target)

    if "wind_dir" in df.columns:
        rad = np.radians(df["wind_dir"])
        sin_i = pd.Series(np.sin(rad), index=df.index).reindex(df.index.union(target))
        cos_i = pd.Series(np.cos(rad), index=df.index).reindex(df.index.union(target))
        sin_i = sin_i.interpolate("time").reindex(target)
        cos_i = cos_i.interpolate("time").reindex(target)
        out["wind_dir"] = (np.degrees(np.arctan2(sin_i, cos_i)) + 360.0) % 360.0

    if "precip_mm" in df.columns:
        # An hourly accumulation spread over its four blocks. Forward-fill
        # rather than interpolate: the total must be conserved.
        out["precip_mm"] = (
            df["precip_mm"].reindex(df.index.union(target)).ffill().reindex(target) / 4.0
        )

    # Irradiance and speeds are physically non-negative; interpolation between
    # a zero and a positive value can undershoot slightly.
    for col in ("ghi", "dni", "dhi", "wind_ms", "wind_100_ms", "gust_ms", "precip_mm"):
        if col in out.columns:
            out[col] = out[col].clip(lower=0.0)

    out = out.dropna(subset=["temp_c"])
    out.index.name = "time_utc"
    return out.reset_index()


def add_time_features(blocks: pd.DataFrame) -> pd.DataFrame:
    """Attach IST calendar and block columns.

    Every downstream consumer needs these and none of them should re-derive
    them; the block index in particular must come from one place or a chart and
    a table will eventually disagree about which block a row belongs to.
    """
    df = blocks.copy()
    ist = df["time_utc"].dt.tz_convert(IST)

    df["time_ist"] = ist
    df["despatch_date"] = ist.dt.date
    df["day_of_year"] = ist.dt.dayofyear.astype(float)
    df["hour"] = (ist.dt.hour + ist.dt.minute / 60.0).astype(float)
    # Block 1 is 00:00–00:15, so the index is 1-based.
    df["block"] = ((ist.dt.hour * 60 + ist.dt.minute) // 15 + 1).astype(int)
    return df


def weather_arrays(blocks: pd.DataFrame) -> dict[str, np.ndarray]:
    """Extract the dict of numpy arrays the physics models expect."""
    keys = (
        "ghi",
        "dni",
        "dhi",
        "temp_c",
        "wind_ms",
        # 100 m wind is what the hub-height extrapolation actually uses: every
        # hub in this fleet sits at 80-100 m, so interpolating down from 100 m
        # with the measured shear beats projecting up from 10 m with an assumed
        # exponent. Omitting this key silently costs a wind farm a third of its
        # output, because physics.hub_height_speed falls back to the assumption.
        "wind_100_ms",
        "pressure_pa",
        "day_of_year",
        "hour",
    )
    return {k: blocks[k].to_numpy(dtype=float) for k in keys if k in blocks.columns}


def latest_available_archive_date() -> date:
    """The most recent date the archive reliably covers.

    The archive trails real time by a couple of days, and `_previous_day3`
    needs the run from three days before that. Asking for yesterday returns
    nulls that would silently become NaN rows in the training set, so the
    dataset builder stops here instead.
    """
    return (datetime.now(IST) - timedelta(days=5)).date()
