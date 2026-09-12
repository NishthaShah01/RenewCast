"""Persistence: a SQLite database and an on-disk weather cache.

Two stores, because they hold two different kinds of thing.

**SQLite** holds what must survive and be joined: forecast runs, their blocks,
and measured actuals. Accuracy is a join between forecasts and actuals on
(site, timestamp), and a join is what a database is for.

**The file cache** holds raw weather API responses keyed by request. They are
large, immutable once fetched, and disposable — writing them into rows would
bloat the database for no query benefit.

A note on Render: its filesystem is ephemeral, so the database resets on
redeploy. That is acceptable here because forecasts regenerate on demand and
the trained models live in git, not in the database. If this ever needed to
retain history across deploys, this is the file that would change.
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

from app.config import settings

# ═════════════════════════════════════════════════════════════════════════
# SCHEMA
# ═════════════════════════════════════════════════════════════════════════

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forecast_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id        TEXT    NOT NULL,
    issued_at      TEXT    NOT NULL,   -- ISO 8601 with offset, IST
    despatch_date  TEXT    NOT NULL,   -- YYYY-MM-DD
    horizon_hours  INTEGER NOT NULL,
    model_version  TEXT    NOT NULL,
    degraded       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_runs_site_date
    ON forecast_runs (site_id, despatch_date);

CREATE TABLE IF NOT EXISTS forecast_blocks (
    run_id      INTEGER NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
    block       INTEGER NOT NULL CHECK (block BETWEEN 1 AND 96),
    ts          TEXT    NOT NULL,
    lead_hours  REAL    NOT NULL,
    p10         REAL    NOT NULL,
    p50         REAL    NOT NULL,
    p90         REAL    NOT NULL,
    physics_mw  REAL    NOT NULL,
    PRIMARY KEY (run_id, block)
);

-- Measured generation, from CSV upload or a public dataset.
-- (site_id, ts) is the key the accuracy join runs on.
CREATE TABLE IF NOT EXISTS actuals (
    site_id   TEXT NOT NULL,
    ts        TEXT NOT NULL,
    block     INTEGER NOT NULL CHECK (block BETWEEN 1 AND 96),
    actual_mw REAL NOT NULL,
    source    TEXT NOT NULL DEFAULT 'upload',
    PRIMARY KEY (site_id, ts)
);

CREATE INDEX IF NOT EXISTS ix_actuals_site_block
    ON actuals (site_id, block);

-- Operator overrides of the assumed site parameters. Sparse by design: a row
-- exists only for a field someone actually changed, so the registry stays the
-- single source of defaults.
CREATE TABLE IF NOT EXISTS site_overrides (
    site_id    TEXT NOT NULL,
    field      TEXT NOT NULL,
    value      TEXT NOT NULL,   -- JSON-encoded scalar
    updated_at TEXT NOT NULL,
    PRIMARY KEY (site_id, field)
);
"""


def _connect() -> sqlite3.Connection:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


_schema_ready = False


def _ensure_schema() -> None:
    """Create the schema once per process, on first database use.

    Guarding this here rather than relying on the API's startup hook means
    every entry point is safe: the server, the training scripts, and the test
    suite all touch the database without a caller having to remember to
    initialise it first. It is a flag check on the hot path and a single
    `executescript` on the cold one.
    """
    global _schema_ready
    if _schema_ready:
        return
    conn = _connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
    _schema_ready = True


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """A connection that commits on success and rolls back on failure.

    Opened per use rather than held globally: SQLite connections are cheap,
    and a long-lived one shared across threads is a source of locking bugs
    that only appear under concurrent requests.
    """
    _ensure_schema()
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if absent. Idempotent; safe to call on every boot."""
    _ensure_schema()


# ═════════════════════════════════════════════════════════════════════════
# FORECAST HISTORY
# ═════════════════════════════════════════════════════════════════════════


def save_forecast_run(
    *,
    site_id: str,
    issued_at: datetime,
    despatch_date: str,
    horizon_hours: int,
    model_version: str,
    degraded: bool,
    blocks: list[dict[str, Any]],
) -> int:
    """Record a forecast so it can later be scored against actuals.

    Returns the run id. `blocks` entries need block, ts, lead_hours, p10, p50,
    p90 and physics_mw.
    """
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO forecast_runs
                 (site_id, issued_at, despatch_date, horizon_hours,
                  model_version, degraded)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                site_id,
                issued_at.isoformat(),
                despatch_date,
                horizon_hours,
                model_version,
                int(degraded),
            ),
        )
        run_id = int(cur.lastrowid or 0)
        conn.executemany(
            """INSERT INTO forecast_blocks
                 (run_id, block, ts, lead_hours, p10, p50, p90, physics_mw)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    run_id,
                    b["block"],
                    b["ts"] if isinstance(b["ts"], str) else b["ts"].isoformat(),
                    b["lead_hours"],
                    b["p10"],
                    b["p50"],
                    b["p90"],
                    b["physics_mw"],
                )
                for b in blocks
            ],
        )
        return run_id


def latest_run_id(site_id: str, despatch_date: str) -> int | None:
    with db() as conn:
        row = conn.execute(
            """SELECT id FROM forecast_runs
               WHERE site_id = ? AND despatch_date = ?
               ORDER BY issued_at DESC LIMIT 1""",
            (site_id, despatch_date),
        ).fetchone()
    return int(row["id"]) if row else None


def scored_blocks(site_id: str, limit: int = 5000) -> list[sqlite3.Row]:
    """Forecast blocks that have a matching actual — the accuracy dataset.

    The join is on timestamp, not block number, because block 42 on two
    different days is two different things.
    """
    with db() as conn:
        return conn.execute(
            """SELECT fb.block, fb.ts, fb.lead_hours,
                      fb.p10, fb.p50, fb.p90, fb.physics_mw,
                      a.actual_mw
               FROM forecast_blocks fb
               JOIN forecast_runs  fr ON fr.id = fb.run_id
               JOIN actuals        a  ON a.site_id = fr.site_id AND a.ts = fb.ts
               WHERE fr.site_id = ?
               ORDER BY fb.ts DESC
               LIMIT ?""",
            (site_id, limit),
        ).fetchall()


# ═════════════════════════════════════════════════════════════════════════
# ACTUALS
# ═════════════════════════════════════════════════════════════════════════


def upsert_actuals(site_id: str, rows: list[dict[str, Any]], source: str = "upload") -> int:
    """Insert or replace measured generation. Returns the row count written.

    Replace rather than ignore: a re-upload is someone correcting the data,
    and silently keeping the old value would make that correction invisible.
    """
    with db() as conn:
        conn.executemany(
            """INSERT INTO actuals (site_id, ts, block, actual_mw, source)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(site_id, ts) DO UPDATE SET
                   block = excluded.block,
                   actual_mw = excluded.actual_mw,
                   source = excluded.source""",
            [
                (
                    site_id,
                    r["ts"] if isinstance(r["ts"], str) else r["ts"].isoformat(),
                    r["block"],
                    r["actual_mw"],
                    source,
                )
                for r in rows
            ],
        )
    return len(rows)


def actuals_count(site_id: str) -> int:
    with db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM actuals WHERE site_id = ?", (site_id,)
        ).fetchone()
    return int(row["n"])


def actuals_summary(site_id: str) -> dict[str, Any]:
    with db() as conn:
        count_row = conn.execute(
            "SELECT COUNT(*) AS n, MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM actuals WHERE site_id = ?",
            (site_id,),
        ).fetchone()
        recent = conn.execute(
            "SELECT ts, block, actual_mw, source FROM actuals WHERE site_id = ? ORDER BY ts DESC LIMIT 96",
            (site_id,),
        ).fetchall()
        scored_count = conn.execute(
            """SELECT COUNT(*) AS n
               FROM forecast_blocks fb
               JOIN forecast_runs fr ON fr.id = fb.run_id
               JOIN actuals a ON a.site_id = fr.site_id AND a.ts = fb.ts
               WHERE fr.site_id = ?""",
            (site_id,),
        ).fetchone()

    return {
        "count": int(count_row["n"]) if count_row else 0,
        "date_range_start": count_row["min_ts"] if count_row and count_row["min_ts"] else None,
        "date_range_end": count_row["max_ts"] if count_row and count_row["max_ts"] else None,
        "scored_blocks_count": int(scored_count["n"]) if scored_count else 0,
        "recent": [dict(r) for r in recent],
    }


# ═════════════════════════════════════════════════════════════════════════
# SITE OVERRIDES
# ═════════════════════════════════════════════════════════════════════════


def set_override(site_id: str, field: str, value: Any, when: datetime) -> None:
    with db() as conn:
        conn.execute(
            """INSERT INTO site_overrides (site_id, field, value, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(site_id, field) DO UPDATE SET
                   value = excluded.value,
                   updated_at = excluded.updated_at""",
            (site_id, field, json.dumps(value), when.isoformat()),
        )


def get_overrides(site_id: str) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            "SELECT field, value FROM site_overrides WHERE site_id = ?", (site_id,)
        ).fetchall()
    return {r["field"]: json.loads(r["value"]) for r in rows}


# ═════════════════════════════════════════════════════════════════════════
# WEATHER CACHE
# ═════════════════════════════════════════════════════════════════════════


class FileCache:
    """TTL cache for weather API responses, one JSON file per key.

    Open-Meteo is free but rate-limited, and a demo that reloads a page
    twenty times must not issue twenty fetches. Expiry is checked on read
    from the file's mtime, so nothing needs to sweep the directory.
    """

    def __init__(self, directory: Path, ttl_minutes: int) -> None:
        self.dir = directory
        self.ttl_seconds = ttl_minutes * 60
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Keys are built from site id and request parameters, so they are
        # already filesystem-safe; the replace is belt-and-braces.
        safe = key.replace("/", "_").replace(":", "-")
        return self.dir / f"{safe}.json"

    def get(self, key: str) -> dict[str, Any] | None:
        """Cached payload, or None if missing, expired or unreadable.

        A corrupt file returns None rather than raising: a bad cache entry
        should cost one refetch, not a failed request.
        """
        path = self._path(key)
        if not path.exists():
            return None
        if self.ttl_seconds and (time.time() - path.stat().st_mtime) > self.ttl_seconds:
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def set(self, key: str, payload: dict[str, Any]) -> None:
        """Write atomically, so a crash mid-write can't leave a half file
        that the next reader then has to treat as corrupt."""
        path = self._path(key)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(path)

    def age_minutes(self, key: str) -> float | None:
        """How stale a cached entry is. The UI's freshness badge shows this."""
        path = self._path(key)
        if not path.exists():
            return None
        return (time.time() - path.stat().st_mtime) / 60.0


weather_cache = FileCache(settings.cache_path, settings.weather_cache_ttl_min)
