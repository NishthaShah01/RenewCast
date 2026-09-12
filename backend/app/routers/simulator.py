"""What-If Simulator endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.data.sites import get_site
from app.schemas import SimulatorDefaultsResponse, SimulatorRequest, SimulatorResponse
from app.services.simulator import get_site_defaults, run_simulation
from app.services.weather import WeatherUnavailable

router = APIRouter(prefix="/simulate", tags=["simulator"])


@router.post("", response_model=SimulatorResponse)
def simulate_scenario(req: SimulatorRequest) -> SimulatorResponse:
    """Run what-if simulation comparing baseline against modified operating assumptions."""
    try:
        return run_simulation(req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Site not found: {exc}") from exc
    except WeatherUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "weather_unavailable",
                "detail": str(exc),
                "hint": "The weather provider may be rate-limiting. Retry in a moment.",
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_scenario_parameter",
                "detail": str(exc),
                "hint": "Ensure battery and operational constraints are within valid ranges.",
            },
        ) from exc


@router.get("/defaults/{site_id}", response_model=SimulatorDefaultsResponse)
def site_defaults(site_id: str) -> SimulatorDefaultsResponse:
    """Retrieve authoritative baseline parameters for a site."""
    try:
        site = get_site(site_id)
        defaults = get_site_defaults(site)
        return SimulatorDefaultsResponse(
            site_id=site.id,
            site_name=site.name,
            capacity_mw=site.capacity_mw,
            defaults=defaults,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Site not found: {exc}") from exc
