"""Forecast endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.data.sites import get_site, list_sites
from app.schemas import EnergySummary, ForecastResponse
from app.services.forecast import generate_forecast, summarise_day
from app.services.weather import WeatherUnavailable

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/{site_id}", response_model=ForecastResponse)
def site_forecast(
    site_id: str,
    horizon_hours: int = Query(
        default=settings.default_horizon_hours,
        ge=1,
        le=settings.max_horizon_hours,
        description="Forecast horizon in hours, capped at 72.",
    ),
) -> ForecastResponse:
    """Probabilistic forecast for one site, per despatch block.

    Starts at block 1 of the current despatch day so the caller has the whole
    96-block spine, including elapsed blocks. `current_block` and
    `revision_horizon_block` mark now and the first actionable block.
    """
    site = get_site(site_id)
    try:
        return generate_forecast(site, horizon_hours)
    except WeatherUnavailable as exc:
        # 503, not 500: the fault is upstream and the right client behaviour is
        # to retry. The message is written for display.
        raise HTTPException(
            status_code=503,
            detail={
                "error": "weather_unavailable",
                "detail": str(exc),
                "hint": "The weather provider may be rate-limiting. Retry in a minute.",
            },
        ) from exc


@router.get("/{site_id}/summary", response_model=EnergySummary)
def site_summary(site_id: str) -> EnergySummary:
    """Energy, peak and mean capacity factor for today at one site."""
    site = get_site(site_id)
    try:
        return summarise_day(generate_forecast(site, 24))
    except WeatherUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("", response_model=list[EnergySummary])
def fleet_summary(
    technology: str | None = Query(default=None, pattern="^(solar|wind)$"),
) -> list[EnergySummary]:
    """Today's summary for every site.

    Sites that fail are omitted rather than failing the whole response: a fleet
    view missing one row is useful, a fleet view that is a 500 is not.
    """
    out: list[EnergySummary] = []
    for site in list_sites(technology):  # type: ignore[arg-type]
        try:
            out.append(summarise_day(generate_forecast(site, 24)))
        except Exception:
            continue
    return out
