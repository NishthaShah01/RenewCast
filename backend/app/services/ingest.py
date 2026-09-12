"""Historical Generation CSV Ingestion Service.

Parses, validates, maps columns, and stores historical actual generation records
for renewable sites. Integrates with existing store and time-block arithmetic.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any

from dateutil import parser as dateutil_parser

from app.core.timeblocks import block_of, to_ist
from app.data.sites import Site, get_site
from app.schemas import (
    IngestPreviewRow,
    IngestResponse,
    IngestValidateResponse,
    SkippedRowDetail,
)
from app.store import upsert_actuals

TIMESTAMP_EXACT_CANDIDATES = [
    "timestamp",
    "datetime",
    "date_time",
    "time",
    "date",
    "ts",
    "period_start",
    "interval_start",
    "block_time",
]

GENERATION_EXACT_CANDIDATES = [
    "generation_mw",
    "actual_mw",
    "metered_mw",
    "power_mw",
    "generation",
    "actual",
    "power",
    "output_mw",
    "output",
    "mw",
]


def detect_mapping(headers: list[str]) -> dict[str, str | None]:
    """Auto-detect timestamp and generation columns from CSV headers.

    Strictly avoids ambiguous mapping: if multiple columns qualify as
    candidates, neither is silently mapped so the user can explicitly choose.
    """
    clean_headers = [h.strip() for h in headers if h.strip()]

    def norm(h: str) -> str:
        return h.lower().replace("-", "_").replace(" ", "_")

    # 1. Check exact canonical candidates
    exact_ts = [h for h in clean_headers if norm(h) in TIMESTAMP_EXACT_CANDIDATES]
    exact_gen = [h for h in clean_headers if norm(h) in GENERATION_EXACT_CANDIDATES]

    detected_ts: str | None = None
    if len(exact_ts) == 1:
        detected_ts = exact_ts[0]
    elif len(exact_ts) > 1:
        # Check if one is uniquely 'timestamp' or 'datetime'
        top_ts = [h for h in exact_ts if norm(h) in ("timestamp", "datetime", "date_time")]
        if len(top_ts) == 1:
            detected_ts = top_ts[0]

    detected_gen: str | None = None
    if len(exact_gen) == 1:
        detected_gen = exact_gen[0]
    elif len(exact_gen) > 1:
        # Check if one is uniquely 'generation_mw' or 'actual_mw'
        top_gen = [h for h in exact_gen if norm(h) in ("generation_mw", "actual_mw")]
        if len(top_gen) == 1:
            detected_gen = top_gen[0]

    # 2. Check partial matches only if not found and completely unambiguous
    excluded_keywords = [
        "id", "site", "plant", "type", "status", "flag", "loss", "tariff",
        "cost", "co2", "unit", "note", "comment", "forecast", "schedule",
    ]

    if detected_ts is None and len(exact_ts) == 0:
        candidates = [
            h for h in clean_headers
            if any(k in norm(h) for k in ["timestamp", "datetime", "time", "date"])
            and not any(ex in norm(h) for ex in excluded_keywords)
        ]
        if len(candidates) == 1:
            detected_ts = candidates[0]

    if detected_gen is None and len(exact_gen) == 0:
        candidates = [
            h for h in clean_headers
            if any(k in norm(h) for k in ["gen", "power", "actual", "mw"])
            and not any(ex in norm(h) for ex in excluded_keywords)
        ]
        if len(candidates) == 1:
            detected_gen = candidates[0]

    return {"timestamp": detected_ts, "generation_mw": detected_gen}


def parse_timestamp_safe(val: str) -> datetime | None:
    """Parse string timestamp safely into an IST datetime.

    Rejects ambiguous or arbitrary numbers and ensures valid 2000..2100 year range.
    """
    val = val.strip()
    if not val or len(val) < 4:
        return None

    # Discard pure numbers (e.g. "12345" or "100")
    if val.isdigit():
        return None

    # Try ISO 8601 first
    try:
        normalized = val.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if 2000 <= dt.year <= 2100:
            return to_ist(dt)
    except Exception:
        pass

    # Try dateutil parser with dayfirst=True (standard in India)
    try:
        if any(sep in val for sep in ("-", "/", "T", ":")):
            dt = dateutil_parser.parse(val, dayfirst=True)
            if 2000 <= dt.year <= 2100:
                return to_ist(dt)
    except Exception:
        pass

    return None


def determine_resolution(timestamps: list[datetime]) -> str:
    """Infer the temporal resolution of parsed timestamps.

    Sorts a sample of timestamps to ensure resolution is correctly determined
    even if rows are slightly out of order in the file.
    """
    if len(timestamps) < 2:
        return "other"

    sample = sorted(timestamps[:200])
    deltas_min: list[float] = []
    for i in range(len(sample) - 1):
        d = (sample[i + 1] - sample[i]).total_seconds() / 60.0
        if d > 0:
            deltas_min.append(d)

    if not deltas_min:
        return "other"

    deltas_min.sort()
    median_delta = deltas_min[len(deltas_min) // 2]

    if 13.0 <= median_delta <= 17.0:
        return "15-minute"
    if 50.0 <= median_delta <= 70.0:
        return "hourly"
    return "other"


def validate_csv_content(
    content_str: str,
    site: Site,
    timestamp_col: str | None = None,
    generation_col: str | None = None,
) -> IngestValidateResponse:
    """Analyze and validate CSV content without writing to storage."""
    f = io.StringIO(content_str)
    reader = csv.reader(f)

    try:
        headers = next(reader)
    except StopIteration:
        headers = []

    clean_headers = [h.strip() for h in headers if h.strip()]
    auto_mapping = detect_mapping(clean_headers)

    ts_col = timestamp_col if (timestamp_col and timestamp_col in clean_headers) else auto_mapping["timestamp"]
    gen_col = generation_col if (generation_col and generation_col in clean_headers) else auto_mapping["generation_mw"]

    if not ts_col or not gen_col:
        missing: list[str] = []
        if not ts_col:
            missing.append("Timestamp")
        if not gen_col:
            missing.append("Generation (MW)")

        msg = (
            f"{' and '.join(missing)} column {'is' if len(missing) == 1 else 'are'} missing. "
            f"Map CSV columns to {', '.join(missing)} to proceed."
        )

        return IngestValidateResponse(
            site_id=site.id,
            site_name=site.name,
            capacity_mw=site.capacity_mw,
            technology=site.technology,
            headers=clean_headers,
            detected_mapping={"timestamp": ts_col, "generation_mw": gen_col},
            preview_rows=[],
            total_rows=0,
            valid_rows_count=0,
            invalid_rows_count=0,
            resolution="other",
            date_range_start=None,
            date_range_end=None,
            is_chronological=True,
            duplicate_count=0,
            summary_message=msg,
        )

    ts_idx = clean_headers.index(ts_col)
    gen_idx = clean_headers.index(gen_col)

    preview_rows: list[IngestPreviewRow] = []
    total_rows = 0
    valid_count = 0
    invalid_count = 0
    seen_ts: set[str] = set()
    duplicate_count = 0
    valid_datetimes: list[datetime] = []
    is_chronological = True
    prev_dt: datetime | None = None

    for row_idx, row in enumerate(reader, start=1):
        if not any(cell.strip() for cell in row):
            continue  # ignore blank lines

        total_rows += 1
        raw_ts = row[ts_idx].strip() if ts_idx < len(row) else ""
        raw_gen = row[gen_idx].strip() if gen_idx < len(row) else ""

        row_errors: list[str] = []
        parsed_dt: datetime | None = None
        gen_mw: float | None = None
        block: int | None = None

        # Validate timestamp
        if not raw_ts:
            row_errors.append("Timestamp is missing. Check for empty timestamp cells.")
        else:
            parsed_dt = parse_timestamp_safe(raw_ts)
            if parsed_dt is None:
                row_errors.append(
                    f"Timestamp '{raw_ts}' could not be parsed safely. Use ISO 8601 (YYYY-MM-DD HH:MM) or DD/MM/YYYY HH:MM."
                )
            else:
                iso_ts = parsed_dt.isoformat()
                if iso_ts in seen_ts:
                    duplicate_count += 1
                    row_errors.append(f"Duplicate timestamp '{raw_ts}'. Duplicate records in the file will be skipped.")
                else:
                    seen_ts.add(iso_ts)

                if prev_dt and parsed_dt < prev_dt:
                    is_chronological = False

                prev_dt = parsed_dt
                block = block_of(parsed_dt)

        # Validate generation
        if not raw_gen:
            row_errors.append("Generation value is missing. Check for empty generation cells.")
        else:
            try:
                gen_mw = float(raw_gen)
                if gen_mw < 0:
                    row_errors.append(f"Negative generation ({gen_mw:.2f} MW). Output cannot be negative.")
                elif gen_mw > site.capacity_mw * 1.25:
                    row_errors.append(
                        f"Generation ({gen_mw:.1f} MW) exceeds plant capacity ({site.capacity_mw:.0f} MW). "
                        "Check the units (MW vs kW) or site selection."
                    )
            except ValueError:
                row_errors.append(f"Non-numeric generation '{raw_gen}'. Expected a numeric MW value.")

        is_valid = len(row_errors) == 0
        if is_valid:
            valid_count += 1
            if parsed_dt:
                valid_datetimes.append(parsed_dt)
        else:
            invalid_count += 1

        if len(preview_rows) < 20:
            preview_rows.append(
                IngestPreviewRow(
                    row_index=row_idx,
                    raw_timestamp=raw_ts,
                    raw_generation=raw_gen,
                    parsed_ts=parsed_dt.isoformat() if parsed_dt else None,
                    block=block,
                    generation_mw=gen_mw,
                    valid=is_valid,
                    errors=row_errors,
                )
            )

    resolution = determine_resolution(valid_datetimes)
    min_dt = min(valid_datetimes) if valid_datetimes else None
    max_dt = max(valid_datetimes) if valid_datetimes else None
    start_str = min_dt.strftime("%d %b %Y %H:%M") if min_dt else None
    end_str = max_dt.strftime("%d %b %Y %H:%M") if max_dt else None

    if total_rows == 0:
        msg = "CSV file contains no data rows."
    elif invalid_count == 0:
        msg = f"All {valid_count:,} rows are valid and ready to import."
    elif valid_count == 0:
        msg = f"All {invalid_count:,} rows contain validation errors. Check column mappings or timestamp formats."
    else:
        msg = f"{valid_count:,} valid rows ready for import. {invalid_count:,} rows will be skipped."

    return IngestValidateResponse(
        site_id=site.id,
        site_name=site.name,
        capacity_mw=site.capacity_mw,
        technology=site.technology,
        headers=clean_headers,
        detected_mapping={"timestamp": ts_col, "generation_mw": gen_col},
        preview_rows=preview_rows,
        total_rows=total_rows,
        valid_rows_count=valid_count,
        invalid_rows_count=invalid_count,
        resolution=resolution,
        date_range_start=start_str,
        date_range_end=end_str,
        is_chronological=is_chronological,
        duplicate_count=duplicate_count,
        summary_message=msg,
    )


def execute_ingest(
    content_str: str,
    site: Site,
    timestamp_col: str | None = None,
    generation_col: str | None = None,
) -> IngestResponse:
    """Parse CSV, validate each row, and persist valid records into the actuals store."""
    f = io.StringIO(content_str)
    reader = csv.reader(f)

    try:
        headers = next(reader)
    except StopIteration:
        return IngestResponse(
            site_id=site.id,
            site_name=site.name,
            capacity_mw=site.capacity_mw,
            technology=site.technology,
            imported_rows=0,
            skipped_rows=0,
            resolution="other",
            message="Empty CSV file.",
        )

    clean_headers = [h.strip() for h in headers if h.strip()]
    auto_mapping = detect_mapping(clean_headers)

    ts_col = timestamp_col if (timestamp_col and timestamp_col in clean_headers) else auto_mapping["timestamp"]
    gen_col = generation_col if (generation_col and generation_col in clean_headers) else auto_mapping["generation_mw"]

    if not ts_col:
        raise ValueError("Timestamp column is missing. Map a CSV column to Timestamp.")
    if not gen_col:
        raise ValueError("Generation column is missing. Map a CSV column to Generation (MW).")

    ts_idx = clean_headers.index(ts_col)
    gen_idx = clean_headers.index(gen_col)

    valid_records: list[dict[str, Any]] = []
    skipped_records: list[SkippedRowDetail] = []
    valid_dts: list[datetime] = []
    seen_ts: set[str] = set()

    for row_idx, row in enumerate(reader, start=1):
        if not any(cell.strip() for cell in row):
            continue

        raw_ts = row[ts_idx].strip() if ts_idx < len(row) else ""
        raw_gen = row[gen_idx].strip() if gen_idx < len(row) else ""

        # Validate timestamp
        if not raw_ts:
            skipped_records.append(
                SkippedRowDetail(
                    row_index=row_idx,
                    raw_timestamp=raw_ts,
                    raw_generation=raw_gen,
                    reason="Timestamp is missing.",
                )
            )
            continue

        parsed_dt = parse_timestamp_safe(raw_ts)
        if parsed_dt is None:
            skipped_records.append(
                SkippedRowDetail(
                    row_index=row_idx,
                    raw_timestamp=raw_ts,
                    raw_generation=raw_gen,
                    reason="Timestamp could not be parsed safely. Use ISO 8601 or DD/MM/YYYY.",
                )
            )
            continue

        iso_ts = parsed_dt.isoformat()
        if iso_ts in seen_ts:
            skipped_records.append(
                SkippedRowDetail(
                    row_index=row_idx,
                    raw_timestamp=raw_ts,
                    raw_generation=raw_gen,
                    reason="Duplicate timestamp in file. Earlier record was preserved.",
                )
            )
            continue
        seen_ts.add(iso_ts)

        # Validate generation
        if not raw_gen:
            skipped_records.append(
                SkippedRowDetail(
                    row_index=row_idx,
                    raw_timestamp=raw_ts,
                    raw_generation=raw_gen,
                    reason="Generation value is missing.",
                )
            )
            continue

        try:
            gen_mw = float(raw_gen)
            if gen_mw < 0:
                skipped_records.append(
                    SkippedRowDetail(
                        row_index=row_idx,
                        raw_timestamp=raw_ts,
                        raw_generation=raw_gen,
                        reason=f"Negative generation ({gen_mw:.2f} MW). Output cannot be negative.",
                    )
                )
                continue
            if gen_mw > site.capacity_mw * 1.25:
                skipped_records.append(
                    SkippedRowDetail(
                        row_index=row_idx,
                        raw_timestamp=raw_ts,
                        raw_generation=raw_gen,
                        reason=(
                            f"Generation ({gen_mw:.1f} MW) exceeds plant capacity ({site.capacity_mw:.0f} MW). "
                            "Check units or site selection."
                        ),
                    )
                )
                continue
        except ValueError:
            skipped_records.append(
                SkippedRowDetail(
                    row_index=row_idx,
                    raw_timestamp=raw_ts,
                    raw_generation=raw_gen,
                    reason=f"Non-numeric generation '{raw_gen}'. Expected a numeric MW value.",
                )
            )
            continue

        # Row is valid
        valid_records.append(
            {
                "ts": iso_ts,
                "block": block_of(parsed_dt),
                "actual_mw": gen_mw,
            }
        )
        valid_dts.append(parsed_dt)

    # Persist valid records into SQLite actuals table
    imported_count = 0
    if valid_records:
        imported_count = upsert_actuals(site.id, valid_records, source="upload")

    resolution = determine_resolution(valid_dts)
    min_dt = min(valid_dts) if valid_dts else None
    max_dt = max(valid_dts) if valid_dts else None
    start_str = min_dt.strftime("%d %b %Y") if min_dt else None
    end_str = max_dt.strftime("%d %b %Y") if max_dt else None

    if len(skipped_records) == 0:
        msg = f"Successfully imported all {imported_count:,} generation records for {site.name}."
    elif imported_count > 0:
        msg = f"Imported {imported_count:,} rows. {len(skipped_records):,} rows skipped due to validation errors."
    else:
        msg = f"No rows imported. All {len(skipped_records):,} rows contained validation errors."

    return IngestResponse(
        site_id=site.id,
        site_name=site.name,
        capacity_mw=site.capacity_mw,
        technology=site.technology,
        imported_rows=imported_count,
        skipped_rows=len(skipped_records),
        resolution=resolution,
        date_range_start=start_str,
        date_range_end=end_str,
        message=msg,
        skipped_rows_data=skipped_records,
    )

