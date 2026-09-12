"""Tests for Historical Generation CSV Ingestion, Validation, and History.

Verifies:
- Column auto-detection (canonical and ambiguous avoidance)
- Timestamp parsing and IST conversion
- Temporal resolution detection (15-minute, hourly, other)
- Capacity, negative, duplicate, and non-numeric guards
- End-to-end API endpoints (/api/ingest/validate, /api/ingest/csv, /api/history/{site_id})
- Partial import recovery and skipped row details
"""

from __future__ import annotations

import io
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.config import IST
from app.data.sites import get_site
from app.main import app
from app.services.ingest import (
    detect_mapping,
    determine_resolution,
    execute_ingest,
    parse_timestamp_safe,
    validate_csv_content,
)
from app.store import actuals_count, actuals_summary


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# ── Column Mapping Detection ───────────────────────────────────────────────


def test_detect_mapping_exact() -> None:
    headers = ["timestamp", "generation_mw", "site_id"]
    mapping = detect_mapping(headers)
    assert mapping["timestamp"] == "timestamp"
    assert mapping["generation_mw"] == "generation_mw"


def test_detect_mapping_aliases() -> None:
    headers = ["DateTime", "Actual_MW"]
    mapping = detect_mapping(headers)
    assert mapping["timestamp"] == "DateTime"
    assert mapping["generation_mw"] == "Actual_MW"

    headers2 = ["time", "power"]
    mapping2 = detect_mapping(headers2)
    assert mapping2["timestamp"] == "time"
    assert mapping2["generation_mw"] == "power"


def test_detect_mapping_ambiguous_never_guesses() -> None:
    # Multiple timestamp candidates
    headers = ["start_time", "end_time", "generation_mw"]
    mapping = detect_mapping(headers)
    assert mapping["timestamp"] is None
    assert mapping["generation_mw"] == "generation_mw"

    # Multiple power candidates
    headers2 = ["timestamp", "forecast_mw", "actual_mw"]
    mapping2 = detect_mapping(headers2)
    assert mapping2["timestamp"] == "timestamp"
    # actual_mw is uniquely prioritized over forecast_mw
    assert mapping2["generation_mw"] == "actual_mw"

    # Truly ambiguous power columns
    headers3 = ["timestamp", "power_unit_1", "power_unit_2"]
    mapping3 = detect_mapping(headers3)
    assert mapping3["generation_mw"] is None


# ── Timestamp Parsing & Resolution ─────────────────────────────────────────


def test_parse_timestamp_iso() -> None:
    dt = parse_timestamp_safe("2026-06-01T10:15:00+05:30")
    assert dt is not None
    assert dt.tzinfo == IST
    assert dt.hour == 10
    assert dt.minute == 15


def test_parse_timestamp_dayfirst() -> None:
    dt = parse_timestamp_safe("15/06/2026 12:00")
    assert dt is not None
    assert dt.day == 15
    assert dt.month == 6
    assert dt.year == 2026


def test_parse_timestamp_invalid() -> None:
    assert parse_timestamp_safe("") is None
    assert parse_timestamp_safe("not_a_date") is None
    assert parse_timestamp_safe("12345") is None
    assert parse_timestamp_safe("1980-01-01") is None  # Out of range


def test_determine_resolution_15_minute() -> None:
    dts = [
        datetime(2026, 6, 1, 0, 0, tzinfo=IST),
        datetime(2026, 6, 1, 0, 15, tzinfo=IST),
        datetime(2026, 6, 1, 0, 30, tzinfo=IST),
        datetime(2026, 6, 1, 0, 45, tzinfo=IST),
    ]
    assert determine_resolution(dts) == "15-minute"


def test_determine_resolution_hourly() -> None:
    dts = [
        datetime(2026, 6, 1, 0, 0, tzinfo=IST),
        datetime(2026, 6, 1, 1, 0, tzinfo=IST),
        datetime(2026, 6, 1, 2, 0, tzinfo=IST),
    ]
    assert determine_resolution(dts) == "hourly"


# ── Validation & Ingest Service Logic ──────────────────────────────────────


def test_validate_csv_content_clean() -> None:
    site = get_site("bhadla")  # 2245 MW
    csv_data = (
        "timestamp,generation_mw\n"
        "2026-06-01T00:00:00+05:30,0.0\n"
        "2026-06-01T00:15:00+05:30,0.0\n"
        "2026-06-01T12:00:00+05:30,1500.5\n"
    )
    res = validate_csv_content(csv_data, site)
    assert res.total_rows == 3
    assert res.valid_rows_count == 3
    assert res.invalid_rows_count == 0
    assert len(res.preview_rows) == 3
    assert res.preview_rows[0].valid is True
    assert res.preview_rows[2].block == 49


def test_validate_csv_content_with_errors() -> None:
    site = get_site("bhadla")  # 2245 MW
    csv_data = (
        "timestamp,generation_mw\n"
        "2026-06-01T00:00:00+05:30,-10.0\n"  # negative
        "2026-06-01T00:15:00+05:30,99999.0\n"  # exceeds capacity
        "invalid_timestamp,50.0\n"  # unparseable
        "2026-06-01T00:00:00+05:30,100.0\n"  # duplicate
        ",100.0\n"  # missing timestamp
        "2026-06-01T01:00:00+05:30,\n"  # missing generation
        "2026-06-01T01:15:00+05:30,abc\n"  # non-numeric
    )
    res = validate_csv_content(csv_data, site)
    assert res.total_rows == 7
    assert res.valid_rows_count == 0
    assert res.invalid_rows_count == 7
    assert res.preview_rows[0].valid is False
    assert "Negative generation" in res.preview_rows[0].errors[0]
    assert "exceeds plant capacity" in res.preview_rows[1].errors[0]
    assert "could not be parsed safely" in res.preview_rows[2].errors[0]
    assert "Duplicate timestamp" in res.preview_rows[3].errors[0]


def test_partial_ingest_execution() -> None:
    site = get_site("pavagada")  # 2050 MW
    csv_data = (
        "timestamp,generation_mw\n"
        "2026-07-01T10:00:00+05:30,800.0\n"
        "2026-07-01T10:15:00+05:30,-50.0\n"  # bad (negative)
        "2026-07-01T10:30:00+05:30,950.0\n"
    )
    result = execute_ingest(csv_data, site, "timestamp", "generation_mw")
    assert result.imported_rows == 2
    assert result.skipped_rows == 1
    assert len(result.skipped_rows_data) == 1
    assert result.skipped_rows_data[0].row_index == 2
    assert "Negative generation" in result.skipped_rows_data[0].reason


# ── End-to-End Router Tests ────────────────────────────────────────────────


def test_ingest_validate_endpoint(client: TestClient) -> None:
    csv_bytes = b"ts,actual_mw\n2026-08-01T06:00:00+05:30,120.0\n"
    response = client.post(
        "/api/ingest/validate",
        data={"site_id": "charanka"},
        files={"file": ("history.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["site_id"] == "charanka"
    assert data["detected_mapping"]["timestamp"] == "ts"
    assert data["detected_mapping"]["generation_mw"] == "actual_mw"
    assert data["valid_rows_count"] == 1


def test_ingest_csv_and_history_endpoint(client: TestClient) -> None:
    csv_bytes = (
        b"timestamp,generation_mw\n"
        b"2026-08-10T12:00:00+05:30,500.0\n"
        b"2026-08-10T12:15:00+05:30,520.0\n"
    )
    response = client.post(
        "/api/ingest/csv",
        data={"site_id": "muppandal", "timestamp_col": "timestamp", "generation_col": "generation_mw"},
        files={"file": ("data.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["imported_rows"] == 2
    assert res_data["skipped_rows"] == 0

    # Query GET /api/history/muppandal
    history_resp = client.get("/api/history/muppandal")
    assert history_resp.status_code == 200
    hist = history_resp.json()
    assert hist["site_id"] == "muppandal"
    assert hist["actuals_count"] >= 2
    assert hist["date_range_start"] is not None
