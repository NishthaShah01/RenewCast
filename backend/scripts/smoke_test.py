#!/usr/bin/env python
"""Smoke test — is a running RenewCast backend actually serving?

Checks that every endpoint the UI depends on answers, with a success status and
the JSON keys the frontend reads. Run it against a local server before a demo,
or against a deployment after one.

    python scripts/smoke_test.py
    python scripts/smoke_test.py --base-url https://renewcast-api.onrender.com

## Why this exists next to a pytest suite

The unit tests assert that the maths is right; they import the services
directly and never open a socket. This asserts that the service is *up* and
that the shapes on the wire are the ones the client expects. Those fail
differently: a passing test suite coexists happily with a typo'd route prefix,
a CORS rule that rejects the browser, or an unset model directory.

## What counts as failure

A required check that fails exits non-zero — suitable for CI or a pre-demo
gate. Two things are deliberately *not* required:

  - `/api/copilot` when no `GEMINI_API_KEY` is set. The deterministic explainer
    is a supported mode, not a degraded one, so the check reports the mode and
    passes either way. It is skipped only if the server itself is unreachable.
  - `/api/accuracy` when no models are trained. On a fresh clone there are no
    metrics to serve and a 404 there is correct behaviour, not a defect.

Forecast endpoints hit a live weather provider, so the timeout is generous and
a 503 is reported as a provider problem rather than a service defect — the
distinction matters when deciding whether to debug or simply retry.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any

# No httpx import. The backend depends on it, but a smoke test that fails
# because its own HTTP client is missing tells you nothing about the server —
# urllib is in the standard library and cannot be the reason for a red run.

DEFAULT_BASE_URL = "http://localhost:8000"

# Generous: /api/forecast fans out to a live weather API on a cache miss, and a
# cold Render instance has to wake up first.
DEFAULT_TIMEOUT_S = 60.0


class CheckFailed(Exception):
    """A required check did not pass. Carries copy fit for the summary line."""


def _get(url: str, timeout: float) -> tuple[int, Any]:
    """GET a URL, returning (status, parsed body).

    Error responses are read rather than raised: the backend writes its 404s
    and 503s as JSON with a `hint`, and that body is the most useful thing to
    print when a check fails.
    """
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except Exception:
            return exc.code, None
    except urllib.error.URLError as exc:
        raise CheckFailed(f"cannot reach {url} - {exc.reason}") from exc


def _post(url: str, payload: dict, timeout: float) -> tuple[int, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except Exception:
            return exc.code, None
    except urllib.error.URLError as exc:
        raise CheckFailed(f"cannot reach {url} - {exc.reason}") from exc


def _require_keys(body: Any, keys: tuple[str, ...], where: str) -> None:
    if not isinstance(body, dict):
        raise CheckFailed(f"{where}: expected a JSON object, got {type(body).__name__}")
    missing = [k for k in keys if k not in body]
    if missing:
        raise CheckFailed(f"{where}: missing {', '.join(missing)}")


def _require_status(status: int, expected: int, where: str, body: Any = None) -> None:
    if status != expected:
        hint = ""
        if isinstance(body, dict):
            detail = body.get("detail") or body.get("error")
            if detail:
                hint = f" - {detail}"
        raise CheckFailed(f"{where}: expected {expected}, got {status}{hint}")


# ═════════════════════════════════════════════════════════════════════════
# CHECKS
# ═════════════════════════════════════════════════════════════════════════
#
# Each returns a one-line note for the summary, or raises CheckFailed. Ordered
# so that later checks can use what earlier ones discovered — the site id for
# the forecast check comes from the sites list rather than being hardcoded,
# because a hardcoded id is a second source of truth that silently rots.


def check_health(base: str, timeout: float, state: dict) -> str:
    status, body = _get(f"{base}/api/health", timeout)
    _require_status(status, 200, "GET /api/health", body)
    _require_keys(
        body,
        (
            "status",
            "version",
            "server_time_ist",
            "current_block",
            "revision_horizon_block",
            "models_loaded",
            "copilot_mode",
        ),
        "GET /api/health",
    )

    if body["status"] not in ("ok", "degraded"):
        raise CheckFailed(f"GET /api/health: unexpected status {body['status']!r}")
    if not 1 <= body["current_block"] <= 96:
        raise CheckFailed(
            f"GET /api/health: current_block {body['current_block']} outside 1-96"
        )

    state["models_loaded"] = bool(body["models_loaded"])
    state["copilot_mode"] = body["copilot_mode"]

    return (
        f"{body['status']}, v{body['version']}, block {body['current_block']}, "
        f"models {'loaded' if body['models_loaded'] else 'absent'}, "
        f"copilot {body['copilot_mode']}"
    )


def check_sites(base: str, timeout: float, state: dict) -> str:
    status, body = _get(f"{base}/api/sites", timeout)
    _require_status(status, 200, "GET /api/sites", body)
    _require_keys(body, ("sites", "count"), "GET /api/sites")

    sites = body["sites"]
    if not sites:
        raise CheckFailed("GET /api/sites: returned an empty fleet")
    if body["count"] != len(sites):
        raise CheckFailed(
            f"GET /api/sites: count {body['count']} disagrees with {len(sites)} sites"
        )

    for key in ("id", "name", "technology", "capacity_mw", "evacuation_limit_mw"):
        if key not in sites[0]:
            raise CheckFailed(f"GET /api/sites: site object missing {key}")

    state["site_id"] = sites[0]["id"]
    state["site_name"] = sites[0]["name"]
    return f"{body['count']} sites, first is {sites[0]['id']}"


def check_forecast(base: str, timeout: float, state: dict) -> str:
    site_id = state["site_id"]
    # 24 h rather than the API's 72 h default: same code path, a third of the
    # weather payload, and the horizon echo is what proves the parameter landed.
    url = f"{base}/api/forecast/{site_id}?horizon_hours=24"
    status, body = _get(url, timeout)

    if status == 503:
        raise CheckFailed(
            f"GET /api/forecast/{site_id}: weather provider unavailable (503). "
            "Retry in a minute - this is the upstream feed, not the service."
        )
    _require_status(status, 200, f"GET /api/forecast/{site_id}", body)
    _require_keys(
        body,
        (
            "site",
            "issued_at",
            "despatch_date",
            "horizon_hours",
            "blocks",
            "current_block",
            "revision_horizon_block",
            "weather_source",
            "model_version",
            "degraded",
        ),
        f"GET /api/forecast/{site_id}",
    )

    if body["horizon_hours"] != 24:
        raise CheckFailed(
            f"GET /api/forecast/{site_id}: asked for 24 h, response says "
            f"{body['horizon_hours']} h - the query parameter did not land"
        )

    blocks = body["blocks"]
    if not blocks:
        raise CheckFailed(f"GET /api/forecast/{site_id}: no blocks returned")

    for key in ("block", "timestamp", "label", "p10", "p50", "p90"):
        if key not in blocks[0]:
            raise CheckFailed(f"GET /api/forecast/{site_id}: block missing {key}")

    # Band ordering is the one invariant worth checking on the wire: a crossed
    # quantile reaching the UI would be drawn as a negative-height band.
    crossed = [b["block"] for b in blocks if not b["p10"] <= b["p50"] <= b["p90"]]
    if crossed:
        raise CheckFailed(
            f"GET /api/forecast/{site_id}: P10<=P50<=P90 violated in "
            f"{len(crossed)} blocks, first at block {crossed[0]}"
        )

    state["forecast_ok"] = True
    mode = "physics only" if body["degraded"] else body["model_version"]
    return f"{len(blocks)} blocks, {body['horizon_hours']} h, {mode}"


def check_decisions(base: str, timeout: float, state: dict) -> str:
    site_id = state["site_id"]
    status, body = _get(f"{base}/api/decisions/{site_id}?horizon_hours=24", timeout)

    if status == 503:
        raise CheckFailed(
            f"GET /api/decisions/{site_id}: weather provider unavailable (503)."
        )
    _require_status(status, 200, f"GET /api/decisions/{site_id}", body)
    _require_keys(
        body,
        (
            "site",
            "despatch_date",
            "schedule_basis",
            "blocks",
            "actions",
            "deficit_energy_mwh",
            "surplus_energy_mwh",
            "curtailment_energy_mwh",
            "net_cost_inr",
            "net_co2_tonnes",
            "headline",
        ),
        f"GET /api/decisions/{site_id}",
    )

    blocks = body["blocks"]
    if not blocks:
        raise CheckFailed(f"GET /api/decisions/{site_id}: no blocks returned")

    # One despatch day, one row per block. Duplicates here mean the day filter
    # broke, and every block-keyed consumer in the UI would silently mis-join.
    numbers = [b["block"] for b in blocks]
    if len(numbers) != len(set(numbers)):
        raise CheckFailed(
            f"GET /api/decisions/{site_id}: duplicate block numbers - "
            "the despatch-day filter is not holding"
        )
    if len(blocks) > 96:
        raise CheckFailed(
            f"GET /api/decisions/{site_id}: {len(blocks)} blocks for one "
            "despatch day, which has 96"
        )

    if not body["headline"].strip():
        raise CheckFailed(f"GET /api/decisions/{site_id}: empty headline")

    return (
        f"{len(blocks)} blocks, {len(body['actions'])} actions, "
        f"net INR {body['net_cost_inr']:,.0f}"
    )


def check_accuracy(base: str, timeout: float, state: dict) -> str:
    status, body = _get(f"{base}/api/accuracy", timeout)

    # No models, no metrics. Correct behaviour on a fresh clone, so this is
    # reported rather than failed — health already told us whether to expect
    # models at all.
    if status == 404 and not state.get("models_loaded", True):
        return "no metrics (no models trained) - expected"

    _require_status(status, 200, "GET /api/accuracy", body)
    _require_keys(
        body,
        ("model_version", "trained_at", "ground_truth", "quantiles", "technologies"),
        "GET /api/accuracy",
    )
    if not body["technologies"]:
        raise CheckFailed("GET /api/accuracy: no technologies reported")

    for tech in body["technologies"]:
        for key in ("technology", "nmae_pct", "skill_pct", "pi_coverage"):
            if key not in tech:
                raise CheckFailed(f"GET /api/accuracy: technology missing {key}")

    names = ", ".join(t["technology"] for t in body["technologies"])
    return f"v{body['model_version']}, {names}"


def check_copilot(base: str, timeout: float, state: dict) -> str:
    status, body = _post(
        f"{base}/api/copilot",
        {"site_id": state["site_id"], "question": "What should I do in the next hour?"},
        timeout,
    )

    if status == 503:
        raise CheckFailed("POST /api/copilot: weather provider unavailable (503).")
    _require_status(status, 200, "POST /api/copilot", body)
    _require_keys(body, ("answer", "mode", "grounded_on"), "POST /api/copilot")

    if body["mode"] not in ("gemini", "deterministic"):
        raise CheckFailed(f"POST /api/copilot: unexpected mode {body['mode']!r}")
    if not body["answer"].strip():
        raise CheckFailed("POST /api/copilot: empty answer")

    note = f"{body['mode']}, {len(body['answer'])} chars"
    if body["mode"] == "deterministic" and state.get("copilot_mode") == "gemini":
        # A key is configured but the answer came from the fallback: the quota
        # is exhausted or the call failed. Not a service defect — the numbers
        # are identical — but worth surfacing before a demo.
        note += " (fell back despite a configured key - check quota)"
    return note


# Required checks gate the exit code. Optional ones report and never fail the
# run: copilot because the deterministic mode is legitimate, accuracy because
# an untrained clone has nothing to serve.
CHECKS: tuple[tuple[str, Any, bool], ...] = (
    ("GET  /api/health", check_health, True),
    ("GET  /api/sites", check_sites, True),
    ("GET  /api/forecast/{id}", check_forecast, True),
    ("GET  /api/decisions/{id}", check_decisions, True),
    ("GET  /api/accuracy", check_accuracy, False),
    ("POST /api/copilot", check_copilot, False),
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that a running RenewCast backend serves what the UI needs."
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"Backend root, without /api (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_S,
        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT_S:.0f})",
    )
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    print(f"RenewCast smoke test -> {base}\n")

    state: dict[str, Any] = {}
    failures: list[str] = []
    results: list[tuple[str, str, str]] = []

    for label, check, required in CHECKS:
        started = time.monotonic()
        try:
            note = check(base, args.timeout, state)
            elapsed = time.monotonic() - started
            results.append(("PASS", label, f"{note}  [{elapsed:.1f}s]"))
        except CheckFailed as exc:
            elapsed = time.monotonic() - started
            verdict = "FAIL" if required else "WARN"
            results.append((verdict, label, f"{exc}  [{elapsed:.1f}s]"))
            if required:
                failures.append(label)
                # A dead server or a missing site id makes every later check
                # meaningless, so stop rather than print five more failures
                # that all have the same cause.
                if label.endswith("/api/health") or label.endswith("/api/sites"):
                    break
        except KeyError as exc:
            # A dependency never ran — only reachable if an earlier required
            # check broke out, but reported rather than traced back.
            results.append(("SKIP", label, f"needs {exc.args[0]} from an earlier check"))

    width = max(len(label) for _, label, _ in results)
    for verdict, label, note in results:
        print(f"  {verdict}  {label.ljust(width)}  {note}")

    passed = sum(1 for v, _, _ in results if v == "PASS")
    warned = sum(1 for v, _, _ in results if v == "WARN")
    skipped = sum(1 for v, _, _ in results if v == "SKIP")

    print()
    if failures:
        summary = f"FAIL  {passed} passed, {len(failures)} failed"
        if warned:
            summary += f", {warned} warned"
        if skipped:
            summary += f", {skipped} skipped"
        print(summary)
        print(f"      failing: {', '.join(failures)}")
        return 1

    summary = f"PASS  {passed} checks"
    if warned:
        summary += f", {warned} warned"
    if skipped:
        summary += f", {skipped} skipped"
    print(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
