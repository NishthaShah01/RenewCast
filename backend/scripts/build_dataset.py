"""Build the training dataset from archived weather forecasts.

    python scripts/build_dataset.py --days 550

## The construction

For each site, two things are pulled from the archive:

  lead 0        the shortest-lead archived run — the best available estimate of
                the weather that actually occurred. Drives Stage A physics,
                which the synthetic plant response turns into `actual_mw`.

  lead 1, 2, 3  the runs issued 1, 2 and 3 days earlier. Each is a genuine
                forecast, wrong in the way forecasts are wrong. These drive the
                *feature* side.

Joining them on timestamp produces rows that say: "three days out we predicted
this weather; here is what the plant did." That is the mapping a forecaster
actually needs, and the error in it is real meteorological error rather than
noise we chose.

One row per (site, block, lead). Four leads times ~550 days times 96 blocks
times 5 sites is on the order of a million rows, which LightGBM fits in seconds.

Output: `data/dataset_solar.parquet`, `data/dataset_wind.parquet`.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import BACKEND_DIR  # noqa: E402
from app.core.physics import physics_power_mw  # noqa: E402
from app.data.sites import SITES, Site  # noqa: E402
from app.features.build import build_weather_features, features_for  # noqa: E402
from app.features.synthetic_actuals import simulate_actuals  # noqa: E402
from app.services import weather as W  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
# httpx logs every request at INFO, and these URLs are 700 characters of
# percent-encoded variable names. Useful once while debugging, noise in a
# 100-request build.
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("build")

# The archive accepts long ranges, but chunking keeps a transient failure from
# discarding an entire site's pull and keeps memory flat.
CHUNK_DAYS = 150

# Leads to build features at, in days.
#
# Lead 0 is included even though it is also the truth source, and the reason is
# worth stating because it looks like the reanalysis mistake and is not.
#
# Serving lead runs 0 to 72 hours, and the blocks that matter most are the
# nearest ones: the revision horizon is 90 minutes, so the first actionable
# block is always at very short lead. Training only on leads 1-3 days would
# leave `lead_hours` below 24 entirely outside the training range, and a
# gradient-boosted tree cannot extrapolate — every short-lead block would
# silently inherit the 24-hour-lead prediction and carry a band roughly twice
# as wide as it should be, precisely where the operator acts.
#
# The documented cost: at lead 0 the feature weather and the truth weather are
# the same series, so the residual there contains plant imperfection but no
# weather error. Short-lead intervals are therefore mildly overconfident. That
# is unavoidable without real plant telemetry — with no independent
# observations, the shortest-lead run has to serve as truth — and it is
# reported on the accuracy page rather than papered over.
FEATURE_LEAD_DAYS = (0, 1, 2, 3)

# Courtesy pause between requests. The free tier is generous; hammering it is
# both rude and a good way to get a 429 mid-build.
REQUEST_PAUSE_S = 0.35


def _fetch_range(site: Site, start, end, lead_days: int) -> pd.DataFrame:
    """Archive pull across a date range, chunked and concatenated."""
    frames: list[pd.DataFrame] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=CHUNK_DAYS - 1), end)
        frames.append(W.fetch_archive(site, cursor, chunk_end, lead_days=lead_days))
        time.sleep(REQUEST_PAUSE_S)
        cursor = chunk_end + timedelta(days=1)
    return pd.concat(frames, ignore_index=True).drop_duplicates(subset=["time"])


def build_site(site: Site, days: int) -> pd.DataFrame:
    end = W.latest_available_archive_date()
    start = end - timedelta(days=days)
    log.info("%-10s %s to %s", site.id, start, end)

    # ── Truth side ────────────────────────────────────────────────────────
    truth_hourly = _fetch_range(site, start, end, lead_days=0)
    truth = W.add_time_features(W.to_blocks(truth_hourly))
    truth_physics = physics_power_mw(site, W.weather_arrays(truth))
    truth["actual_mw"] = simulate_actuals(site, truth, truth_physics)
    truth["actual_cf"] = truth["actual_mw"] / site.capacity_mw

    log.info(
        "%-10s truth  %6d blocks  mean CF %.1f%%  peak %.0f MW",
        site.id,
        len(truth),
        100 * truth["actual_cf"].mean(),
        truth["actual_mw"].max(),
    )

    target = truth[["time_utc", "actual_mw", "actual_cf"]]

    # ── Feature side, one frame per lead ──────────────────────────────────
    out: list[pd.DataFrame] = []
    for lead_days in FEATURE_LEAD_DAYS:
        # Lead 0 is the frame we already pulled for the truth side. Refetching
        # it would double the request count for identical bytes.
        if lead_days == 0:
            blocks = truth.drop(columns=["actual_mw", "actual_cf"])
        else:
            hourly = _fetch_range(site, start, end, lead_days=lead_days)
            blocks = W.add_time_features(W.to_blocks(hourly))

        # Actual lead time in hours. A run issued at 00:00 UTC `lead_days`
        # earlier is this many hours ahead of the block it describes, so lead
        # grows across each day rather than being constant — which is exactly
        # the structure a live 72-hour forecast has.
        lead_hours = lead_days * 24.0 + blocks["time_utc"].dt.hour.to_numpy(dtype=float)

        feat = build_weather_features(site, blocks, lead_hours)
        merged = feat.merge(target, on="time_utc", how="inner")

        # The learning target: how much Stage A was wrong by, in capacity-factor
        # units. Sign convention is "add this to physics to get reality".
        merged["cf_residual"] = merged["actual_cf"] - merged["physics_cf"]
        merged["site_id"] = site.id
        merged["lead_days"] = lead_days
        out.append(merged)

        log.info(
            "%-10s lead%d  %6d rows  residual mean %+.4f  sd %.4f",
            site.id,
            lead_days,
            len(merged),
            merged["cf_residual"].mean(),
            merged["cf_residual"].std(),
        )

    return pd.concat(out, ignore_index=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=550, help="history length in days")
    ap.add_argument("--sites", type=str, default="", help="comma-separated ids, default all")
    args = ap.parse_args()

    wanted = [s.strip() for s in args.sites.split(",") if s.strip()]
    sites = [s for s in SITES if not wanted or s.id in wanted]

    out_dir = BACKEND_DIR / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    by_tech: dict[str, list[pd.DataFrame]] = {"solar": [], "wind": []}

    for site in sites:
        try:
            by_tech[site.technology].append(build_site(site, args.days))
        except Exception as exc:
            # One site failing should not lose the other four. A partial
            # dataset still trains a usable model.
            log.error("%-10s FAILED: %s", site.id, exc)

    wrote = 0
    for tech, frames in by_tech.items():
        if not frames:
            continue
        df = pd.concat(frames, ignore_index=True)

        keep = ["time_utc", "site_id", "block", "despatch_date", "lead_days"]
        keep += list(features_for(tech))
        keep += ["physics_mw", "actual_mw", "actual_cf", "cf_residual"]
        df = df[[c for c in dict.fromkeys(keep) if c in df.columns]]

        # Rows where the target could not be joined are useless and would
        # become zeros under the feature builder's fillna.
        df = df.dropna(subset=["cf_residual"])

        path = out_dir / f"dataset_{tech}.parquet"
        df.to_parquet(path, index=False)
        wrote += 1
        log.info(
            "wrote %s  %d rows  %d cols  %.1f MB",
            path.name,
            len(df),
            len(df.columns),
            path.stat().st_size / 1e6,
        )

    if not wrote:
        log.error("no data written")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
