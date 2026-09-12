"""Block arithmetic invariants.

`timeblocks.py` is mirrored by the frontend's `src/lib/blocks.ts`, and a
disagreement between them misaligns every chart in the product. These tests
are the backend half of that contract; the frontend has the same cases.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.config import IST
from app.core.timeblocks import (
    block_end,
    block_label,
    block_of,
    block_start,
    block_to_hour,
    blocks_between,
    hour_to_blocks,
    now_ist,
    revision_horizon_block,
    to_ist,
)


def t(hour: int, minute: int = 0) -> datetime:
    """An IST instant on a fixed date, so tests never depend on today."""
    return datetime(2026, 9, 12, hour, minute, tzinfo=IST)


# ── block_of ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (t(0, 0), 1),      # first instant of the despatch day
        (t(0, 14), 1),     # still inside block 1 — blocks are half-open
        (t(0, 15), 2),     # boundary belongs to the *next* block
        (t(10, 30), 43),
        (t(12, 0), 49),    # midday
        (t(23, 45), 96),
        (t(23, 59), 96),   # last instant of the day
    ],
)
def test_block_of(moment: datetime, expected: int) -> None:
    assert block_of(moment) == expected


def test_block_of_converts_from_utc() -> None:
    """A naive timestamp is treated as UTC, not as local wall-clock.

    IST is UTC+5:30, so midnight IST is 18:30 UTC on the *previous* day. That
    date rollover is the trap: a timestamp that looks like the 11th belongs to
    the despatch day of the 12th, and treating it as wall-clock would shift
    the entire day by 22 blocks.
    """
    assert block_of(datetime(2026, 9, 11, 18, 30)) == 1
    assert block_of(datetime(2026, 9, 12, 5, 30)) == 45  # 11:00 IST


def test_to_ist_preserves_instant() -> None:
    naive_utc = datetime(2026, 9, 11, 18, 30)
    ist = to_ist(naive_utc)
    assert (ist.day, ist.hour, ist.minute) == (12, 0, 0)


# ── labels and boundaries ─────────────────────────────────────────────────


def test_block_label_first_and_last() -> None:
    assert block_label(1) == "00:00–00:15"
    assert block_label(43) == "10:30–10:45"
    # The day closes at 24:00, not 00:00, so the interval reads as closed.
    assert block_label(96) == "23:45–24:00"


def test_block_start_and_end_are_contiguous() -> None:
    day = t(9)
    for block in range(1, 96):
        assert block_end(day, block) == block_start(day, block + 1)


def test_block_start_is_midnight_for_block_one() -> None:
    start = block_start(t(17, 42), 1)
    assert (start.hour, start.minute, start.second) == (0, 0, 0)


@pytest.mark.parametrize("bad", [0, 97, -1, 1000])
def test_out_of_range_blocks_raise(bad: int) -> None:
    with pytest.raises(ValueError):
        block_label(bad)
    with pytest.raises(ValueError):
        block_start(t(9), bad)


# ── hour ↔ block ──────────────────────────────────────────────────────────


def test_hour_to_blocks() -> None:
    assert hour_to_blocks(0) == (1, 4)
    assert hour_to_blocks(10) == (41, 44)
    assert hour_to_blocks(23) == (93, 96)


def test_hour_block_round_trip() -> None:
    """Every block maps back into the hour that contains it."""
    for hour in range(24):
        first, last = hour_to_blocks(hour)
        assert last - first == 3
        for block in range(first, last + 1):
            assert block_to_hour(block) == hour


@pytest.mark.parametrize("bad", [-1, 24])
def test_bad_hour_raises(bad: int) -> None:
    with pytest.raises(ValueError):
        hour_to_blocks(bad)


# ── revision horizon ──────────────────────────────────────────────────────


def test_voluntary_horizon_is_six_blocks_out() -> None:
    """A voluntary revision takes effect from the 6th block — 90 minutes."""
    assert revision_horizon_block(t(10, 30)) == 43 + 6


def test_rldc_horizon_is_four_blocks_out() -> None:
    assert revision_horizon_block(t(10, 30), voluntary=False) == 43 + 4


def test_horizon_clamps_at_end_of_day() -> None:
    """Late in the day the horizon saturates at 96 rather than rolling into
    tomorrow: the despatch day is the unit of scheduling."""
    assert revision_horizon_block(t(23, 50)) == 96
    assert revision_horizon_block(t(23, 0)) == 96


def test_horizon_is_always_ahead_of_now() -> None:
    for hour in range(24):
        for minute in (0, 15, 30, 45):
            moment = t(hour, minute)
            assert revision_horizon_block(moment) >= block_of(moment)


# ── durations ─────────────────────────────────────────────────────────────


def test_blocks_between() -> None:
    assert blocks_between(t(10, 0), t(11, 0)) == 4
    assert blocks_between(t(0, 0), t(23, 45)) == 95
    assert blocks_between(t(10, 0), t(10, 14)) == 0


def test_now_ist_is_tz_aware_and_ist() -> None:
    now = now_ist()
    assert now.tzinfo is not None
    assert now.utcoffset() is not None
    assert now.utcoffset().total_seconds() == 5.5 * 3600  # type: ignore[union-attr]
