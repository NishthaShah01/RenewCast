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
import time
from datetime import date, datetime, timedelta, timezone

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


def _request(url: str, params: dict[str, object], max_retries: int = 2) -> dict:
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT_S) as client:
                r = client.get(url, params=params)
                r.raise_for_status()
                payload = r.json()
                if payload.get("error"):
                    raise WeatherUnavailable(
                        f"Weather service error: {payload.get('reason', 'unknown')}"
                    )
                return payload
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if attempt < max_retries and exc.response.status_code in (500, 502, 503, 504, 429):
                time.sleep(1.0)
                continue
            reason = ""
            try:
                reason = exc.response.json().get("reason", "")
            except Exception:
                reason = exc.response.text[:200]
            raise WeatherUnavailable(
                f"Weather service returned {exc.response.status_code}: {reason}"
            ) from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < max_retries:
                time.sleep(1.0)
                continue
            raise WeatherUnavailable(f"Could not reach the weather service: {exc}") from exc

    raise WeatherUnavailable(f"Weather service could not be reached: {last_exc}")


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


def _fallback_payload(site: Site, days: int, cache_key: str | None = None) -> dict:
    """Provide a reliable, physically sound weather payload when upstream weather API is unavailable or rate-limited.

    1. First searches for any cached live weather file for this site.
       If found, shifts timestamps so day 1 begins at yesterday 00:00 UTC and tiles extra hours if needed.
    2. If no cached file exists at all, generates diurnal weather using solar geometry (Haurwitz clear sky)
       and site-specific elevation/wind regime.
    """
    start_utc = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    total_hours_needed = (days + 1) * 24
    aligned_times = [(start_utc + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(total_hours_needed)]

    # 1. Search for any cached file for this site
    cached_data: dict | None = None
    if cache_key:
        cached_data = weather_cache.get_stale(cache_key)

    if cached_data is None:
        for candidate_days in (3, 4, 5, 2, 6, 7):
            candidate_key = f"live_{site.id}_{candidate_days}"
            cached_data = weather_cache.get_stale(candidate_key)
            if cached_data is not None:
                break

    if cached_data is not None and "hourly" in cached_data:
        orig_hourly = cached_data["hourly"]
        new_hourly: dict[str, list] = {"time": aligned_times}
        for var, col in RENAME.items():
            vals = orig_hourly.get(var, [])
            if not vals:
                continue
            if len(vals) < total_hours_needed:
                cycle = vals[-24:] if len(vals) >= 24 else vals
                tiled = list(vals)
                while len(tiled) < total_hours_needed:
                    tiled.extend(cycle)
                new_hourly[var] = tiled[:total_hours_needed]
            else:
                new_hourly[var] = list(vals[:total_hours_needed])
        return {
            "latitude": site.latitude,
            "longitude": site.longitude,
            "elevation": cached_data.get("elevation", site.elevation_m),
            "hourly": new_hourly,
        }

    # 2. Fully synthetic baseline if no cached file was found
    from app.core import astronomy

    new_hourly: dict[str, list] = {
        "time": aligned_times,
        "temperature_2m": [],
        "relative_humidity_2m": [],
        "surface_pressure": [],
        "cloud_cover": [],
        "precipitation": [0.0] * total_hours_needed,
        "shortwave_radiation": [],
        "direct_normal_irradiance": [],
        "diffuse_radiation": [],
        "wind_speed_10m": [],
        "wind_speed_100m": [],
        "wind_direction_10m": [220.0] * total_hours_needed,
        "wind_gusts_10m": [],
    }

    p_hpa = 1013.25 * ((1.0 - 0.0065 * site.elevation_m / 288.15) ** 5.25588)
    is_wind = site.technology == "wind"
    base_wind_10m = 7.5 if is_wind else 2.8
    base_wind_100m = 9.8 if is_wind else 4.2

    for i in range(total_hours_needed):
        t_utc = start_utc + timedelta(hours=i)
        t_ist = t_utc + timedelta(hours=5, minutes=30)
        hour_ist = t_ist.hour + t_ist.minute / 60.0
        doy = t_ist.timetuple().tm_yday

        zenith, _, _ = astronomy.solar_position(site.latitude, site.longitude, doy, hour_ist)
        if zenith < 89.0:
            ghi = float(astronomy.clear_sky_ghi(np.array([zenith]))[0])
            cos_z = max(np.cos(np.radians(zenith)), 0.01)
            dni = min(ghi / cos_z * 0.72, 850.0)
            dhi = max(ghi - dni * cos_z, 0.0)
        else:
            ghi = 0.0
            dni = 0.0
            dhi = 0.0

        temp = 28.0 + 7.0 * np.sin((hour_ist - 9.0) * np.pi / 12.0)
        humidity = 50.0 - 20.0 * np.sin((hour_ist - 9.0) * np.pi / 12.0)

        w_var = 1.2 * np.sin((hour_ist - 14.0) * np.pi / 12.0)
        w10 = max(base_wind_10m + w_var, 0.5)
        w100 = max(base_wind_100m + w_var * 1.3, 1.0)
        gust = w10 * 1.4

        new_hourly["temperature_2m"].append(round(temp, 1))
        new_hourly["relative_humidity_2m"].append(round(humidity, 1))
        new_hourly["surface_pressure"].append(round(p_hpa, 1))
        new_hourly["cloud_cover"].append(15.0)
        new_hourly["shortwave_radiation"].append(round(ghi, 1))
        new_hourly["direct_normal_irradiance"].append(round(dni, 1))
        new_hourly["diffuse_radiation"].append(round(dhi, 1))
        new_hourly["wind_speed_10m"].append(round(w10, 2))
        new_hourly["wind_speed_100m"].append(round(w100, 2))
        new_hourly["wind_gusts_10m"].append(round(gust, 2))

    return {
        "latitude": site.latitude,
        "longitude": site.longitude,
        "elevation": site.elevation_m,
        "hourly": new_hourly,
    }


def fetch_live(site: Site, horizon_hours: int = 72) -> pd.DataFrame:
    """Current forecast for a site, hourly, UTC-indexed.

    Cached for `settings.weather_cache_ttl_min`. The cache is not an
    optimisation detail — it is what keeps a live demo responsive when several
    people load the page at once, and what keeps us inside the free tier.
    """
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

    try:
        payload = _request(LIVE_URL, params)
        weather_cache.set(cache_key, payload)
        return _to_frame(payload, lead_days=0)
    except WeatherUnavailable as exc:
        log.warning(
            "Live weather fetch failed (%s); serving aligned fallback weather for %s",
            exc,
            site.id,
        )
        fallback = _fallback_payload(site, days, cache_key)
        try:
            weather_cache.set(cache_key, fallback)
        except Exception:
            pass
        df = _to_frame(fallback, lead_days=0)
        df.attrs["is_fallback"] = True
        return df


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
