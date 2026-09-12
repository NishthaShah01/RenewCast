"""Forecast generation — Stage A + Stage B, assembled for the API.

The whole pipeline in one place:

    live weather (hourly)
      → 15-minute blocks              weather.to_blocks
      → features                      features.build
      → Stage A physics               core.physics
      → Stage B quantile residuals    the LightGBM bundle
      → P10 / P50 / P90 in MW

## Degraded mode is a first-class path, not an error

With no trained models the service still answers, using Stage A plus a
heuristic interval. `/health` reports `degraded`, the response carries
`degraded: true`, and the UI labels it "Physics only". This matters for a demo
that must survive a fresh clone, and it matters in principle: a forecast whose
uncertainty comes from a documented rule of thumb is more useful than no
forecast, provided it says so.

## Every block carries its block index

The response is keyed by despatch block, not by timestamp alone, and the label
is rendered server-side. Two clients formatting `10:30–10:45` independently
will eventually disagree about the dash, the padding, or the rollover at block
96 — so it is done once, here.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.config import settings
from app.core.timeblocks import (
    IST,
    block_label,
    block_of,
    now_ist,
    revision_horizon_block,
)
from app.data.constants import QUANTILES
from app.data.sites import Site
from app.features.build import build_weather_features, feature_matrix
from app.schemas import EnergySummary, ForecastBlock, ForecastResponse
from app.services import weather as W

log = logging.getLogger("renewcast.forecast")

# z-score for an 80% two-sided interval. Used only in degraded mode; the
# trained path predicts the bounds directly and needs no distributional
# assumption at all.
Z_80 = 1.2816


class ModelBundle:
    """The six boosters plus training metadata.

    Loaded once per process and cached. `available` is false on a fresh clone,
    which is the signal that flips the whole service into degraded mode.
    """

    def __init__(self, model_dir: Path) -> None:
        self.dir = model_dir
        self.models: dict[tuple[str, float], object] = {}
        self.metadata: dict = {}

        meta_path = model_dir / "metadata.json"
        if meta_path.exists():
            try:
                self.metadata = json.loads(meta_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                log.warning("models/metadata.json is unreadable - ignoring")

        for tech in ("solar", "wind"):
            for alpha in QUANTILES:
                path = model_dir / f"{tech}_p{int(alpha * 100)}.joblib"
                if path.exists():
                    try:
                        self.models[(tech, alpha)] = joblib.load(path)
                    except Exception as exc:
                        log.error("could not load %s: %s", path.name, exc)

    def has(self, technology: str) -> bool:
        return all((technology, a) in self.models for a in QUANTILES)

    @property
    def available(self) -> bool:
        return bool(self.models)

    @property
    def version(self) -> str:
        return str(self.metadata.get("model_version", "untrained"))

    def predict_residuals(
        self, technology: str, x: pd.DataFrame
    ) -> dict[float, np.ndarray]:
        return {
            alpha: np.asarray(self.models[(technology, alpha)].predict(x))
            for alpha in QUANTILES
        }


@lru_cache(maxsize=1)
def get_bundle() -> ModelBundle:
    return ModelBundle(settings.model_path)


def reset_bundle() -> None:
    """Drop the cache so a retrain is picked up without a restart."""
    get_bundle.cache_clear()


# ═════════════════════════════════════════════════════════════════════════
# DEGRADED-MODE INTERVAL
# ═════════════════════════════════════════════════════════════════════════


def _heuristic_sigma(
    site: Site, df: pd.DataFrame, lead_hours: np.ndarray
) -> np.ndarray:
    """Capacity-factor standard deviation when no model is loaded.

    Three terms, each with a physical reason rather than a fitted coefficient:

      base        irreducible plant-level uncertainty
      lead        grows as the square root of lead time, the standard scaling
                  for accumulated forecast error
      conditional cloud cover for solar; power-curve steepness for wind, where
                  the same speed error costs most output

    Deliberately conservative — wider than a trained model would give. An
    interval that is too wide is honest about ignorance; one that is too narrow
    invites an operator to act on a bound that will not hold.
    """
    lead_term = 0.02 * np.sqrt(np.maximum(lead_hours, 0.0) / 24.0)

    if site.technology == "solar":
        cloud = df["cloud_pct"].to_numpy(dtype=float) / 100.0
        sigma = 0.025 + lead_term + 0.09 * cloud
        # No sun, no uncertainty. Without this the night-time band would fan
        # out symmetrically around zero, which is both wrong and the kind of
        # chart artefact that destroys trust in everything next to it.
        daylight = df["physics_cf"].to_numpy(dtype=float) > 0.001
        return np.where(daylight, sigma, 0.0)

    cf = df["physics_cf"].to_numpy(dtype=float)
    steepness = 4.0 * np.clip(cf, 0.0, 1.0) * (1.0 - np.clip(cf, 0.0, 1.0))
    return 0.035 + lead_term + 0.10 * steepness


# ═════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═════════════════════════════════════════════════════════════════════════


def generate_forecast(site: Site, horizon_hours: int | None = None) -> ForecastResponse:
    """Probabilistic forecast for one site across the despatch horizon.

    The returned window starts at block 1 of *today*, not at the current block.
    The UI's spine is a whole 96-block day and needs the elapsed blocks to dim
    them; `current_block` says where now is and `revision_horizon_block` says
    where action becomes possible.
    """
    horizon = min(horizon_hours or settings.default_horizon_hours, settings.max_horizon_hours)
    issued = now_ist()
    bundle = get_bundle()

    notes: list[str] = []
    degraded = False

    hourly = W.fetch_live(site, horizon)
    blocks = W.add_time_features(W.to_blocks(hourly))

    # Window: start of today IST through now + horizon.
    day_start = issued.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = issued + timedelta(hours=horizon)
    blocks = blocks[
        (blocks["time_ist"] >= day_start) & (blocks["time_ist"] <= window_end)
    ].reset_index(drop=True)

    if blocks.empty:
        raise RuntimeError("Weather feed returned no blocks inside the forecast window.")

    # Lead time per block, floored at zero. Elapsed blocks get lead 0: they are
    # not predictions any more, and a negative lead is outside anything the
    # model was trained on.
    lead_hours = (
        (blocks["time_ist"] - issued).dt.total_seconds().to_numpy(dtype=float) / 3600.0
    )
    lead_hours = np.maximum(lead_hours, 0.0)

    feat = build_weather_features(site, blocks, lead_hours)
    physics_mw = feat["physics_mw"].to_numpy(dtype=float)
    cap = site.capacity_mw

    if bundle.has(site.technology):
        x = feature_matrix(feat, site.technology)
        residuals = bundle.predict_residuals(site.technology, x)
        stacked = np.vstack([physics_mw + residuals[a] * cap for a in QUANTILES])
        model_version = bundle.version
        weather_source = "Open-Meteo forecast + LightGBM quantile correction"
    else:
        degraded = True
        sigma = _heuristic_sigma(site, feat, lead_hours) * cap
        stacked = np.vstack([physics_mw - Z_80 * sigma, physics_mw, physics_mw + Z_80 * sigma])
        model_version = "physics-only"
        weather_source = "Open-Meteo forecast + deterministic physics"
        notes.append(
            "No trained model is loaded, so this forecast is Stage A physics with "
            "a heuristic uncertainty band. Run scripts/train.py to enable the "
            "learned quantile correction."
        )

    # Independent quantile models can cross — P90 below P50 in a block or two.
    # Sorting is the standard monotonisation and cannot worsen calibration.
    stacked = np.sort(stacked, axis=0)
    p10, p50, p90 = (np.clip(row, 0.0, cap) for row in stacked)

    horizon_block = revision_horizon_block(issued)
    current = block_of(issued)

    out_blocks = [
        ForecastBlock(
            block=int(row.block),
            # Block START, not midpoint. The despatch convention is that block
            # 43 *begins* at 10:30, and an off-by-7.5-minutes timestamp would
            # misalign every chart against every table.
            timestamp=row.time_ist.to_pydatetime(),
            label=block_label(int(row.block)),
            lead_hours=round(float(lead_hours[i]), 2),
            p10=round(float(p10[i]), 2),
            p50=round(float(p50[i]), 2),
            p90=round(float(p90[i]), 2),
            physics_mw=round(float(physics_mw[i]), 2),
            capacity_factor=round(float(p50[i] / cap), 4),
            is_daylight=bool(feat["physics_cf"].iloc[i] > 0.001)
            if site.technology == "solar"
            else True,
        )
        for i, row in enumerate(blocks.itertuples())
    ]

    return ForecastResponse(
        site=site,
        issued_at=issued,
        despatch_date=day_start.date().isoformat(),
        horizon_hours=horizon,
        blocks=out_blocks,
        current_block=current,
        revision_horizon_block=horizon_block,
        weather_source=weather_source,
        model_version=model_version,
        degraded=degraded,
        notes=notes,
    )


def summarise_day(
    response: ForecastResponse, despatch_date: datetime | None = None
) -> EnergySummary:
    """Energy and peak statistics for one despatch day of a forecast.

    MWh is MW divided by 4, because a block is a quarter hour. That factor is
    applied in exactly one place — dropping it is an easy mistake and yields
    numbers four times too large, which look plausible enough to survive review.
    """
    # `despatch_date` is an ISO string on the wire, so it is parsed back to a
    # date for comparison rather than compared against `.date()` objects — the
    # two are not equal and the mismatch would silently fall through to the
    # "no rows" branch and summarise the whole 72-hour horizon as one day.
    target = (
        despatch_date.date()
        if despatch_date is not None
        else date.fromisoformat(response.despatch_date)
    )
    rows = [b for b in response.blocks if b.timestamp.astimezone(IST).date() == target]
    if not rows:
        rows = response.blocks

    p50 = np.array([b.p50 for b in rows])
    peak_idx = int(np.argmax(p50))

    return EnergySummary(
        site_id=response.site.id,
        site_name=response.site.name,
        technology=response.site.technology,
        capacity_mw=response.site.capacity_mw,
        mwh_p10=round(float(sum(b.p10 for b in rows) / 4.0), 1),
        mwh_p50=round(float(sum(b.p50 for b in rows) / 4.0), 1),
        mwh_p90=round(float(sum(b.p90 for b in rows) / 4.0), 1),
        peak_mw=round(float(p50[peak_idx]), 1),
        peak_block=rows[peak_idx].block,
        mean_capacity_factor=round(float(np.mean(p50) / response.site.capacity_mw), 4),
    )
