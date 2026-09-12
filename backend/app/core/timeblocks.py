"""Time-block arithmetic — the keystone of the whole system.

The Indian despatch day is 96 blocks of 15 minutes, beginning 00:00 IST.
Every schedule, declaration of capability and deviation settlement is
expressed per block, so every timestamp RenewCast emits carries its block
index and every time-series surface in the UI aligns to it.

This module is the single source of truth for that arithmetic. The frontend
mirrors it in `src/lib/blocks.ts`. If the two ever disagree, the UI's bands
drift out of alignment and the entire design premise collapses — so the two
implementations are kept deliberately small and identical in behaviour.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.config import IST
from app.data.constants import (
    BLOCK_MINUTES,
    BLOCKS_PER_DAY,
    RLDC_REVISION_LEAD_BLOCKS,
    VOLUNTARY_REVISION_LEAD_BLOCKS,
)


def now_ist() -> datetime:
    """Current time in IST. All block arithmetic is IST-based."""
    return datetime.now(IST)


def to_ist(dt: datetime) -> datetime:
    """Convert any datetime to IST. Naive input is assumed to be UTC."""
    if dt.tzinfo is None:
        from datetime import timezone

        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def block_of(dt: datetime) -> int:
    """Block index (1..96) containing `dt`.

    Block 1 is 00:00–00:15, block 96 is 23:45–24:00.
    """
    ist = to_ist(dt)
    minutes_since_midnight = ist.hour * 60 + ist.minute
    return minutes_since_midnight // BLOCK_MINUTES + 1


def block_start(day: datetime, block: int) -> datetime:
    """Start instant of `block` on the despatch day containing `day`."""
    if not 1 <= block <= BLOCKS_PER_DAY:
        raise ValueError(f"block must be 1..{BLOCKS_PER_DAY}, got {block}")
    ist = to_ist(day)
    midnight = ist.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight + timedelta(minutes=(block - 1) * BLOCK_MINUTES)


def block_end(day: datetime, block: int) -> datetime:
    return block_start(day, block) + timedelta(minutes=BLOCK_MINUTES)


def block_label(block: int) -> str:
    """Human label for a block, e.g. '10:30–10:45'.

    Block 96 ends at 24:00, which is rendered as such rather than 00:00 so the
    despatch day reads as a closed interval.
    """
    if not 1 <= block <= BLOCKS_PER_DAY:
        raise ValueError(f"block must be 1..{BLOCKS_PER_DAY}, got {block}")
    start_min = (block - 1) * BLOCK_MINUTES
    end_min = start_min + BLOCK_MINUTES
    return f"{start_min // 60:02d}:{start_min % 60:02d}–{end_min // 60:02d}:{end_min % 60:02d}"


def revision_horizon_block(
    dt: datetime | None = None, *, voluntary: bool = True
) -> int:
    """First block a schedule revision issued now can still affect.

    A voluntary revision takes effect from the 6th time block; an
    RLDC-initiated revision from the 4th. Blocks before this are locked — no
    amount of forecast accuracy can change them, which is why the UI dims them
    and why forecast value decays with delay rather than with horizon alone.

    Wraps past block 96 without rolling into the next day: the caller gets 96
    when the horizon would spill over, because the despatch day is the unit of
    scheduling.
    """
    lead = VOLUNTARY_REVISION_LEAD_BLOCKS if voluntary else RLDC_REVISION_LEAD_BLOCKS
    return min(block_of(dt or now_ist()) + lead, BLOCKS_PER_DAY)


def hour_to_blocks(hour: int) -> tuple[int, int]:
    """The four blocks spanned by an hour-of-day, as an inclusive range.

    Weather forecasts arrive hourly; schedules are per block. Hour 0 covers
    blocks 1–4, hour 10 covers blocks 41–44.
    """
    if not 0 <= hour <= 23:
        raise ValueError(f"hour must be 0..23, got {hour}")
    first = hour * 4 + 1
    return first, first + 3


def block_to_hour(block: int) -> int:
    """Hour-of-day containing `block`, for joining against hourly weather."""
    if not 1 <= block <= BLOCKS_PER_DAY:
        raise ValueError(f"block must be 1..{BLOCKS_PER_DAY}, got {block}")
    return (block - 1) // 4


def blocks_between(start: datetime, end: datetime) -> int:
    """Number of whole 15-minute blocks between two instants."""
    return int((end - start).total_seconds() // (BLOCK_MINUTES * 60))
