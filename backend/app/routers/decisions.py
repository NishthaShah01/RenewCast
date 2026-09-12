"""Decision endpoints — the despatch plan built on top of a forecast."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.data.sites import get_site
from app.schemas import DecisionResponse
from app.services.decisions import build_decisions
from app.services.forecast import generate_forecast
from app.services.weather import WeatherUnavailable

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("/{site_id}", response_model=DecisionResponse)
def site_decisions(
    site_id: str,
    horizon_hours: int = Query(
        default=24,
        ge=1,
        le=settings.max_horizon_hours,
        description="Planning horizon. Defaults to 24h — one despatch day.",
    ),
) -> DecisionResponse:
    """Priced despatch plan for one site.

    Defaults to 24 hours rather than the forecast's 72, because a despatch plan
    is a document about one despatch day. Three days of battery instructions is
    not a plan an operator can act on; it is a chart.
    """
    site = get_site(site_id)
    try:
        return build_decisions(generate_forecast(site, horizon_hours))
    except WeatherUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "weather_unavailable",
                "detail": str(exc),
                "hint": "The weather provider may be rate-limiting. Retry in a minute.",
            },
        ) from exc
