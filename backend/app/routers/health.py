"""Health and readiness.

More than a liveness probe. This endpoint answers the three questions the UI
needs before it can render anything honestly: what block is it, can the server
still influence the schedule, and is the ML stage actually loaded.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import settings
from app.core.timeblocks import block_of, now_ist, revision_horizon_block
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    now = now_ist()
    models_loaded = settings.model_path.exists() and any(
        settings.model_path.glob("*.joblib")
    )
    return HealthResponse(
        # 'degraded' rather than a 5xx: the server genuinely works without
        # trained models — it serves physics-only forecasts — and reporting
        # that state is more useful than failing the probe.
        status="ok" if models_loaded else "degraded",
        version=settings.version,
        server_time_ist=now,
        current_block=block_of(now),
        revision_horizon_block=revision_horizon_block(now),
        models_loaded=models_loaded,
        copilot_mode=settings.copilot_mode,  # type: ignore[arg-type]
    )
