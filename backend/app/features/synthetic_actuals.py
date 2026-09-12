"""Synthetic plant response — the simulated half of the ground truth.

## Read this before quoting any accuracy number

Per-block generation data for Bhadla, Pavagada, Charanka, Muppandal and
Jaisalmer is **not public**. No API, no dataset, no scrape. So the target the
model trains against is constructed here, and every screen that reports
accuracy says so.

What is real and what is not:

| Component                              | Source                          |
|----------------------------------------|---------------------------------|
| Weather the forecast saw               | **Real** archived forecast runs |
| Weather error growth with lead time    | **Real** — `_previous_dayN`     |
| Sun geometry, clear-sky irradiance     | **Real** physics                |
| Plant conversion of weather to MW      | **Real** physics (Stage A)      |
| Soiling, outages, sub-hourly cloud     | **Simulated** — this module     |

The dominant term in any renewable forecast error is weather uncertainty, and
that part is measured, not invented. What this module adds is the plant's own
imperfection: the reasons a real 2245 MW park does not produce exactly what a
clean-module, fully-available physics model says.

## Why simulate at all rather than train physics-only

Without a target there is no Stage B, and a physics-only forecast has no
uncertainty band — no P10, no P90, nothing for a deficit rule to bind to. The
quantile machinery is the product. Simulating a defensible plant response is
the honest way to exercise it; claiming the output is validated against real
plant telemetry would not be.

Every process below is a documented real phenomenon with a plausible
magnitude, and the whole thing is seeded per site so results are reproducible.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.data.sites import Site

# Soiling accrues at roughly this fraction of output per dry day. Indian desert
# sites are at the severe end of published ranges; Rajasthan dust between
# monsoons is the reason plant O&M schedules exist.
SOILING_RATE_PER_DAY = 0.0022
SOILING_CAP = 0.16

# Rainfall over this much in a block washes modules substantially clean.
RAIN_CLEANING_MM = 2.0

# Manual cleaning cycle, days.
CLEANING_INTERVAL_DAYS = 21

# Probability per block that a forced outage *begins*.
OUTAGE_START_PROB = 0.00035
OUTAGE_MIN_BLOCKS = 4
OUTAGE_MAX_BLOCKS = 40
OUTAGE_DEPTH_RANGE = (0.04, 0.35)

# AR(1) persistence for sub-block variability. 0.85 at 15 minutes gives a
# correlation time near an hour, which is the right order for cloud fields and
# wind gust envelopes.
AR1_RHO = 0.85

# Noise amplitude, as a fraction of output. Solar is noisier than wind at
# 15-minute resolution because a single cloud can take a park from full to half
# in two minutes, whereas a wind farm's many turbines average over the field.
SOLAR_NOISE_SIGMA = 0.055
WIND_NOISE_SIGMA = 0.040


def _ar1(n: int, rng: np.random.Generator, rho: float = AR1_RHO) -> np.ndarray:
    """Unit-variance AR(1) series.

    White noise would be wrong in a way that flatters the model: independent
    per-block errors average out over an hour, so the prediction intervals
    needed to cover them would be narrow and the coverage test would pass
    trivially. Real forecast errors persist — a misplaced cloud field is wrong
    for hours — and persistent error is what makes an 80% interval hard to
    calibrate.
    """
    out = np.empty(n)
    out[0] = rng.standard_normal()
    scale = np.sqrt(1.0 - rho * rho)
    for i in range(1, n):
        out[i] = rho * out[i - 1] + scale * rng.standard_normal()
    return out


def _soiling_factor(
    despatch_dates: np.ndarray,
    precip_mm: np.ndarray,
    rng: np.random.Generator,
) -> np.ndarray:
    """Sawtooth availability loss from dust accumulation.

    Builds linearly through dry spells, drops on rain, and resets on the
    cleaning cycle. This is the largest *systematic* term in the residual, and
    it is why the model has something learnable beyond noise: soiling correlates
    with season and with days-since-rain, both of which the features expose
    through day-of-year and precipitation.
    """
    n = len(precip_mm)
    factor = np.ones(n)
    soil = rng.uniform(0.0, 0.04)
    unique_days = pd.unique(despatch_dates)
    day_index = {d: i for i, d in enumerate(unique_days)}
    last_clean_day = 0

    for i in range(n):
        day = day_index[despatch_dates[i]]

        if precip_mm[i] >= RAIN_CLEANING_MM:
            # Rain removes most but not all deposition.
            soil *= 0.25
        elif day - last_clean_day >= CLEANING_INTERVAL_DAYS:
            soil = 0.0
            last_clean_day = day
        else:
            soil = min(soil + SOILING_RATE_PER_DAY / 96.0, SOILING_CAP)

        factor[i] = 1.0 - soil
    return factor


def _outage_factor(n: int, rng: np.random.Generator) -> np.ndarray:
    """Forced-outage derates: partial, persistent, and rare.

    Modelled as partial rather than total because a 2245 MW park is hundreds of
    independent inverter blocks — a fault takes out a section, not the site.
    These are the events that make the P10 bound earn its keep.
    """
    factor = np.ones(n)
    i = 0
    while i < n:
        if rng.random() < OUTAGE_START_PROB:
            length = int(rng.integers(OUTAGE_MIN_BLOCKS, OUTAGE_MAX_BLOCKS))
            depth = rng.uniform(*OUTAGE_DEPTH_RANGE)
            end = min(i + length, n)
            factor[i:end] = 1.0 - depth
            i = end
        else:
            i += 1
    return factor


def simulate_actuals(
    site: Site,
    truth_blocks: pd.DataFrame,
    physics_mw: np.ndarray,
    seed: int | None = None,
) -> np.ndarray:
    """Plausible measured generation, MW, for a block-indexed frame.

    `physics_mw` must be Stage A driven by the *shortest-lead* archived
    forecast — the closest available proxy for the weather that actually
    occurred. The processes applied on top are the plant's own, not the
    weather's; weather error enters the dataset through the feature side, where
    it is real.

    Seeded from the site id so a rebuild reproduces the same series and an
    accuracy figure is stable between runs.
    """
    rng = np.random.default_rng(seed if seed is not None else abs(hash(site.id)) % (2**32))
    n = len(physics_mw)

    dates = truth_blocks["despatch_date"].to_numpy()
    precip = truth_blocks["precip_mm"].to_numpy(dtype=float)

    factor = _outage_factor(n, rng)

    if site.technology == "solar":
        factor = factor * _soiling_factor(dates, precip, rng)
        sigma = SOLAR_NOISE_SIGMA
        # Cloud amplifies variability: a clear desert noon is highly
        # predictable, a broken-cloud afternoon is not. Scaling the noise by
        # cloud cover is what gives the quantile model a *heteroscedastic*
        # target — the reason P10/P90 must widen in some blocks and not others,
        # which is the entire point of predicting an interval.
        cloud = truth_blocks["cloud_pct"].to_numpy(dtype=float) / 100.0
        amplitude = sigma * (0.35 + 1.3 * cloud)
    else:
        sigma = WIND_NOISE_SIGMA
        # Wind output variance peaks in the steep part of the power curve,
        # where a small speed error is a large power error, and collapses when
        # the turbine is at rated or shut down.
        cf = physics_mw / max(site.capacity_mw, 1.0)
        steepness = 4.0 * cf * (1.0 - cf)  # peaks at cf = 0.5
        amplitude = sigma * (0.3 + 2.2 * steepness)

    noise = _ar1(n, rng) * amplitude
    actual = physics_mw * factor * (1.0 + noise)

    # A plant cannot produce below zero or above nameplate, whatever the noise
    # draw says. Clipping here rather than leaving the model to learn it keeps
    # the residual target clean at the boundaries.
    return np.clip(actual, 0.0, site.capacity_mw)
