"""Historical Generation Ingest and History Router.

Exposes endpoints for CSV file validation, batch ingestion, and site history retrieval.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.data.sites import get_site
from app.schemas import (
    HistoryResponse,
    IngestResponse,
    IngestValidateResponse,
)
from app.services.ingest import execute_ingest, validate_csv_content
from app.store import actuals_summary

log = logging.getLogger("renewcast.ingest")
router = APIRouter(tags=["ingest"])


@router.post("/ingest/validate", response_model=IngestValidateResponse)
async def validate_csv(
    file: Annotated[UploadFile, File(...)],
    site_id: Annotated[str, Form(...)],
    timestamp_col: Annotated[str | None, Form()] = None,
    generation_col: Annotated[str | None, Form()] = None,
) -> IngestValidateResponse:
    """Validate an uploaded CSV, auto-detect column headers, and return a preview."""
    try:
        site = get_site(site_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found.") from exc

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail="Only .csv files are supported. Please upload a valid CSV file.",
        )

    try:
        content_bytes = await file.read()
        # Decode utf-8-sig to automatically strip BOM if present
        content_str = content_bytes.decode("utf-8-sig")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read CSV file content: {exc}. Ensure the file is valid UTF-8 text.",
        ) from exc

    return validate_csv_content(
        content_str=content_str,
        site=site,
        timestamp_col=timestamp_col,
        generation_col=generation_col,
    )


@router.post("/ingest/csv", response_model=IngestResponse)
async def ingest_csv(
    file: Annotated[UploadFile, File(...)],
    site_id: Annotated[str, Form(...)],
    timestamp_col: Annotated[str | None, Form()] = None,
    generation_col: Annotated[str | None, Form()] = None,
) -> IngestResponse:
    """Parse CSV, validate each record, and persist valid generation data."""
    try:
        site = get_site(site_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found.") from exc

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail="Only .csv files are supported. Please upload a valid CSV file.",
        )

    try:
        content_bytes = await file.read()
        content_str = content_bytes.decode("utf-8-sig")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read CSV file content: {exc}.",
        ) from exc

    try:
        result = execute_ingest(
            content_str=content_str,
            site=site,
            timestamp_col=timestamp_col,
            generation_col=generation_col,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/history/{site_id}", response_model=HistoryResponse)
def get_history(site_id: str) -> HistoryResponse:
    """Get historical generation statistics and summary for a site."""
    try:
        site = get_site(site_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found.") from exc

    summary = actuals_summary(site.id)

    return HistoryResponse(
        site_id=site.id,
        site_name=site.name,
        capacity_mw=site.capacity_mw,
        technology=site.technology,
        actuals_count=summary["count"],
        date_range_start=summary["date_range_start"],
        date_range_end=summary["date_range_end"],
        scored_blocks_count=summary["scored_blocks_count"],
        recent_actuals=summary["recent"],
    )
