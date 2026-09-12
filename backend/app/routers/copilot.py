"""Copilot endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.data.sites import get_site
from app.schemas import CopilotRequest, CopilotResponse
from app.services.copilot import answer
from app.services.decisions import build_decisions
from app.services.forecast import generate_forecast
from app.services.weather import WeatherUnavailable

router = APIRouter(prefix="/copilot", tags=["copilot"])


@router.post("", response_model=CopilotResponse)
def ask(req: CopilotRequest) -> CopilotResponse:
    """Answer a question about one site's despatch plan.

    The plan is rebuilt server-side rather than accepted from the client: an
    answer grounded on numbers the caller supplied is an answer about nothing.
    """
    site = get_site(req.site_id)
    try:
        decisions = build_decisions(generate_forecast(site, 24))
    except WeatherUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "weather_unavailable",
                "detail": str(exc),
                "hint": "The weather provider may be rate-limiting. Retry in a minute.",
            },
        ) from exc

    return answer(req.question, decisions)
