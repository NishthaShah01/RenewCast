"""Model accuracy — the metrics page, served from training metadata.

Read from `models/metadata.json` rather than recomputed: these are validation
numbers from a held-out split, and recomputing them on demand would either be
slow or be measured on data the model saw.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.schemas import AccuracyResponse, TechnologyAccuracy

router = APIRouter(prefix="/accuracy", tags=["accuracy"])


@lru_cache(maxsize=1)
def _metadata() -> dict:
    path = Path(settings.model_dir) / "metadata.json"
    if not path.is_absolute():
        from app.config import BACKEND_DIR

        path = BACKEND_DIR / path
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("", response_model=AccuracyResponse)
def accuracy() -> AccuracyResponse:
    """Validation metrics for both models."""
    try:
        meta = _metadata()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "no_trained_model",
                "detail": "No trained model on disk, so there are no accuracy metrics to report.",
                "hint": "Run `python scripts/train.py` to train and write models/metadata.json.",
            },
        ) from exc

    techs = []
    for name, m in meta["technologies"].items():
        techs.append(
            TechnologyAccuracy(
                technology=name,
                rows_train=m["rows_train"],
                rows_valid=m["rows_valid"],
                n_features=len(m["features"]),
                mae_mw=m["mae_mw_p50"],
                mae_mw_physics=m["mae_mw_physics_only"],
                nmae_pct=m["nmae_pct_p50"],
                nmae_pct_physics=m["nmae_pct_physics_only"],
                skill_pct=m["skill_vs_physics_pct"],
                rmse_mw=m["rmse_mw_p50"],
                pi_coverage=m["pi_coverage"],
                pi_nominal=m["pi_nominal"],
                mean_interval_width_mw=m["mean_interval_width_mw"],
            )
        )

    return AccuracyResponse(
        model_version=meta["model_version"],
        trained_at=meta["trained_at"],
        ground_truth=meta["ground_truth"],
        quantiles=meta["quantiles"],
        technologies=techs,
    )
