"""The site registry, read and overridden."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.data.sites import SITES_BY_ID, Technology, list_sites
from app.schemas import Site, SiteListResponse
from app.store import get_overrides

router = APIRouter(prefix="/sites", tags=["sites"])


def _with_overrides(site: Site) -> Site:
    """Apply any operator edits over the registry defaults.

    Overrides are stored sparsely, so this is a shallow merge of the handful
    of top-level fields a user is allowed to change. Unknown keys are ignored
    rather than rejected — a stale override left by an older build should not
    break the site list.
    """
    edits = get_overrides(site.id)
    if not edits:
        return site
    editable = {"capacity_mw", "evacuation_limit_mw", "tariff_per_mwh"}
    applied = {k: v for k, v in edits.items() if k in editable}
    return site.model_copy(update=applied) if applied else site


@router.get("", response_model=SiteListResponse)
def get_sites(
    technology: Technology | None = Query(
        default=None, description="Filter to 'solar' or 'wind'."
    ),
) -> SiteListResponse:
    sites = [_with_overrides(s) for s in list_sites(technology)]
    return SiteListResponse(sites=sites, count=len(sites))


@router.get("/{site_id}", response_model=Site)
def get_one_site(site_id: str) -> Site:
    site = SITES_BY_ID.get(site_id)
    if site is None:
        # The message names the valid options, because a 404 that only says
        # "not found" makes the caller go looking for the list separately.
        raise HTTPException(
            status_code=404,
            detail=(
                f"No site with id '{site_id}'. "
                f"Available: {', '.join(SITES_BY_ID)}."
            ),
        )
    return _with_overrides(site)
