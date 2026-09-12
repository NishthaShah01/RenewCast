"""Train the Stage B quantile models.

    python scripts/train.py

One LightGBM model per (technology, quantile) — six in total. Each predicts the
capacity-factor residual at its quantile; the forecast service adds the
prediction back onto Stage A physics and multiplies by nameplate.

## Why quantile regression and not a point forecast plus an error bar

The standard shortcut is to fit one model, measure its residual spread, and
draw ±1.28σ for an 80% interval. That assumes the error is Gaussian and, worse,
*homoscedastic* — the same width everywhere. Renewable forecast error is
neither. A clear desert noon is predictable to a couple of percent; a
broken-cloud afternoon or a wind speed sitting on the steep part of the power
curve is not. A constant band is simultaneously too wide to be useful at noon
and too narrow to be safe at 4pm, which is precisely when an operator needs it.

Quantile regression fits each bound directly, so the interval width is itself a
prediction. That is what makes "deficit risk assessed against P10" a meaningful
rule rather than a decoration.

## Why the split is chronological

The validation set is the most recent 20% of days, never a random sample.
Adjacent 15-minute blocks are ~0.99 correlated, so a random split puts near
copies of validation rows into training and reports an accuracy the model does
not have. A time split also matches how the thing is used: fit on the past,
predict the future.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import BACKEND_DIR  # noqa: E402
from app.data.constants import PI_NOMINAL_COVERAGE, QUANTILES  # noqa: E402
from app.features.build import TARGET, features_for  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("train")

MODEL_VERSION = "1.0.0"
VALIDATION_FRACTION = 0.20

PARAMS = {
    "objective": "quantile",
    "metric": "quantile",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_child_samples": 40,
    "feature_fraction": 0.85,
    "bagging_fraction": 0.85,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "num_threads": 0,
}
NUM_ROUNDS = 700
EARLY_STOPPING = 60


def chronological_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split on whole despatch days, most recent days held out.

    Splitting on days rather than rows keeps a single day from straddling the
    boundary, which would put its morning in training and its afternoon in
    validation — a subtle leak, since the two share the same weather system.
    """
    days = np.sort(df["despatch_date"].unique())
    cut = days[int(len(days) * (1.0 - VALIDATION_FRACTION))]
    return df[df["despatch_date"] < cut], df[df["despatch_date"] >= cut]


def pinball_loss(y: np.ndarray, pred: np.ndarray, alpha: float) -> float:
    """The loss quantile regression actually minimises.

    Reported because MAE on a P10 prediction is meaningless — P10 is *supposed*
    to sit below the observation 90% of the time, so a good P10 has a large
    MAE by construction. Pinball loss is the scoring rule that rewards a
    correctly-placed bound.
    """
    diff = y - pred
    return float(np.mean(np.maximum(alpha * diff, (alpha - 1.0) * diff)))


def train_technology(tech: str, out_dir: Path) -> dict | None:
    path = BACKEND_DIR / "data" / f"dataset_{tech}.parquet"
    if not path.exists():
        log.warning("no dataset for %s at %s - skipping", tech, path)
        return None

    df = pd.read_parquet(path)
    cols = list(features_for(tech))
    train, valid = chronological_split(df)

    log.info("\n%s", "=" * 68)
    log.info("%s   %d rows  %d features", tech.upper(), len(df), len(cols))
    log.info("train %d rows to %s", len(train), train["despatch_date"].max())
    log.info("valid %d rows from %s", len(valid), valid["despatch_date"].min())
    log.info("=" * 68)

    x_tr = train[cols].astype(float).fillna(0.0)
    y_tr = train[TARGET].astype(float)
    x_va = valid[cols].astype(float).fillna(0.0)
    y_va = valid[TARGET].astype(float)

    preds: dict[float, np.ndarray] = {}
    best_iters: dict[str, int] = {}

    for alpha in QUANTILES:
        params = {**PARAMS, "alpha": alpha}
        booster = lgb.train(
            params,
            lgb.Dataset(x_tr, label=y_tr),
            num_boost_round=NUM_ROUNDS,
            valid_sets=[lgb.Dataset(x_va, label=y_va)],
            callbacks=[lgb.early_stopping(EARLY_STOPPING, verbose=False)],
        )
        pred = booster.predict(x_va, num_iteration=booster.best_iteration)
        preds[alpha] = np.asarray(pred)
        best_iters[f"p{int(alpha * 100)}"] = booster.best_iteration

        joblib.dump(booster, out_dir / f"{tech}_p{int(alpha * 100)}.joblib")
        log.info(
            "  P%-3d  %3d rounds  pinball %.5f",
            int(alpha * 100),
            booster.best_iteration,
            pinball_loss(y_va.to_numpy(), preds[alpha], alpha),
        )

    # ── Evaluate in MW, which is the unit anyone cares about ──────────────
    cap = valid["actual_mw"] / valid["actual_cf"].replace(0, np.nan)
    cap = cap.ffill().bfill().to_numpy()

    physics_mw = valid["physics_mw"].to_numpy()
    actual_mw = valid["actual_mw"].to_numpy()

    p10 = np.clip(physics_mw + preds[0.10] * cap, 0.0, cap)
    p50 = np.clip(physics_mw + preds[0.50] * cap, 0.0, cap)
    p90 = np.clip(physics_mw + preds[0.90] * cap, 0.0, cap)
    # A quantile crossing is possible because the three models are independent.
    # Sorting is the standard remedy and cannot make calibration worse.
    p10, p50, p90 = np.sort(np.vstack([p10, p50, p90]), axis=0)

    mae_model = float(np.mean(np.abs(actual_mw - p50)))
    mae_physics = float(np.mean(np.abs(actual_mw - physics_mw)))
    coverage = float(np.mean((actual_mw >= p10) & (actual_mw <= p90)))

    # Normalised by capacity so solar and wind are comparable, and because
    # nMAE as a percentage of nameplate is how the industry quotes accuracy.
    mean_cap = float(np.mean(cap))
    metrics = {
        "technology": tech,
        "rows_train": int(len(train)),
        "rows_valid": int(len(valid)),
        "features": cols,
        "best_iterations": best_iters,
        "mae_mw_p50": round(mae_model, 2),
        "mae_mw_physics_only": round(mae_physics, 2),
        "nmae_pct_p50": round(100 * mae_model / mean_cap, 3),
        "nmae_pct_physics_only": round(100 * mae_physics / mean_cap, 3),
        "skill_vs_physics_pct": round(100 * (1 - mae_model / mae_physics), 2),
        "rmse_mw_p50": round(float(np.sqrt(np.mean((actual_mw - p50) ** 2))), 2),
        "pi_coverage": round(coverage, 4),
        "pi_nominal": PI_NOMINAL_COVERAGE,
        "pi_coverage_error": round(coverage - PI_NOMINAL_COVERAGE, 4),
        "mean_interval_width_mw": round(float(np.mean(p90 - p10)), 2),
    }

    log.info("")
    log.info("  nMAE  physics only  %6.2f %% of nameplate", metrics["nmae_pct_physics_only"])
    log.info("  nMAE  with Stage B  %6.2f %% of nameplate", metrics["nmae_pct_p50"])
    log.info("  skill from ML       %6.2f %%", metrics["skill_vs_physics_pct"])
    log.info(
        "  PI coverage         %6.1f %%  (nominal %.0f %%)",
        100 * coverage,
        100 * PI_NOMINAL_COVERAGE,
    )
    log.info("  mean P10-P90 width  %6.0f MW", metrics["mean_interval_width_mw"])

    # Top features, as a sanity check rather than a chart. If `lead_hours` and
    # the irradiance terms are not near the top, something is wrong upstream.
    gains = sorted(
        zip(cols, booster.feature_importance("gain")), key=lambda kv: -kv[1]
    )[:8]
    total = sum(g for _, g in gains) or 1.0
    log.info("  top features: %s", ", ".join(f"{k} {100 * v / total:.0f}%" for k, v in gains))

    return metrics


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=str, default="models")
    args = ap.parse_args()

    out_dir = BACKEND_DIR / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    results = [m for tech in ("solar", "wind") if (m := train_technology(tech, out_dir))]
    if not results:
        log.error("nothing trained - run scripts/build_dataset.py first")
        return 1

    meta = {
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "quantiles": list(QUANTILES),
        "ground_truth": "synthetic plant response over real archived forecast weather",
        "technologies": {m["technology"]: m for m in results},
    }
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log.info("\nwrote %s", (out_dir / "metadata.json").name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
