"""API request and response models.

This file is the contract between the two halves of the product. The frontend
types in `src/lib/types.ts` mirror it, so a change here is a change there.

One rule shapes everything below: **every forecast value travels with its
block index.** Not a bare timestamp — the block. The UI's entire layout is a
96-column spine, and a payload that forces the client to re-derive block
numbers from timestamps is a payload that will eventually derive them
differently from the backend and drift.

Site domain models live in `app.data.sites`; they are returned directly rather
than copied into parallel DTOs.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.data.sites import Site, Technology

# ═════════════════════════════════════════════════════════════════════════
# HEALTH
# ═════════════════════════════════════════════════════════════════════════


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str

    server_time_ist: datetime
    """Server clock in IST. The UI's block clock reconciles against this, so a
    laptop with a wrong clock doesn't silently shift the despatch day."""

    current_block: int = Field(ge=1, le=96)
    revision_horizon_block: int = Field(ge=1, le=96)
    """First block a voluntary revision issued right now could still affect."""

    models_loaded: bool
    """False means the server is serving physics-only forecasts. The UI says
    so rather than pretending the ML stage ran."""

    copilot_mode: Literal["gemini", "deterministic"]
    """Which explainer is active, surfaced so a reader always knows whether
    narration came from a language model. The numbers never do."""


# ═════════════════════════════════════════════════════════════════════════
# SITES
# ═════════════════════════════════════════════════════════════════════════


class SiteListResponse(BaseModel):
    sites: list[Site]
    count: int


# ═════════════════════════════════════════════════════════════════════════
# FORECAST
# ═════════════════════════════════════════════════════════════════════════


class ForecastBlock(BaseModel):
    """One 15-minute block of forecast. The atomic unit of the whole system."""

    block: int = Field(ge=1, le=96)
    timestamp: datetime
    """Block *start* instant, in IST. Always the start, never the midpoint."""

    label: str
    """Pre-rendered '10:30–10:45'. Computed server-side so the two clients of
    this API cannot format it two ways."""

    lead_hours: float = Field(ge=0)
    """Hours between issue time and this block. The model is trained with lead
    time as a feature, and accuracy is reported against it, so the client needs
    it explicitly rather than by subtraction."""

    p10: float = Field(ge=0)
    p50: float = Field(ge=0)
    p90: float = Field(ge=0)
    """MW. Deficit risk is judged against p10, surplus against p90, and energy
    accounting against p50. The three are not interchangeable."""

    physics_mw: float = Field(ge=0)
    """Stage A output before the learned correction. Kept in the payload so the
    accuracy page can show what the ML stage actually contributed."""

    capacity_factor: float = Field(ge=0, le=1)
    """p50 over nameplate. The comparable number across sites of different size
    — which is why the fleet view ranks on this and not on MW."""

    is_daylight: bool
    """Drives the shaded daylight region behind solar charts. Sent rather than
    computed client-side because it comes from the same solar-position code
    that produced the forecast."""

    temp_c: float | None = None
    cloud_pct: float | None = None
    wind_ms: float | None = None
    wind_100_ms: float | None = None
    ghi: float | None = None
    clear_sky_index: float | None = None
    solar_elevation: float | None = None



class ForecastResponse(BaseModel):
    site: Site
    issued_at: datetime
    """When this forecast was produced, IST. The freshness badge reads this."""

    despatch_date: str
    """ISO date of the despatch day these blocks belong to."""

    horizon_hours: int
    blocks: list[ForecastBlock]

    current_block: int = Field(ge=1, le=96)
    revision_horizon_block: int = Field(ge=1, le=96)
    """Everything left of this is locked. The UI dims it."""

    weather_source: str
    model_version: str
    degraded: bool = False
    """True when the ML stage was unavailable and these are physics-only
    numbers. Shown, never hidden."""

    notes: list[str] = Field(default_factory=list)
    """Caveats worth putting on screen, e.g. a stale weather cache."""


# ═════════════════════════════════════════════════════════════════════════
# ENERGY SUMMARY
# ═════════════════════════════════════════════════════════════════════════


class EnergySummary(BaseModel):
    """Block-integrated totals. Each block is a quarter-hour, so MWh is
    MW ÷ 4 — a factor it is easy to drop, hence one place that applies it."""

    site_id: str
    site_name: str
    technology: Technology
    capacity_mw: float
    """Site identity travels with the numbers.

    The fleet endpoint returns a list of these and omits sites whose forecast
    failed, so position in the list is not a reliable key back to the site
    registry — two rows both reading 1,240 MWh would be indistinguishable, and
    a dropped site would silently shift every row after it onto the wrong name.
    """

    mwh_p10: float
    mwh_p50: float
    mwh_p90: float
    peak_mw: float
    peak_block: int = Field(ge=1, le=96)
    mean_capacity_factor: float = Field(ge=0, le=1)


# ═════════════════════════════════════════════════════════════════════════
# DECISIONS
# ═════════════════════════════════════════════════════════════════════════
#
# A forecast is not a decision. The gap between them is the part of this
# product a control-room operator would actually pay for, so it is modelled
# explicitly rather than left as a chart to squint at.
#
# The three quantiles are not interchangeable here, and the asymmetry is the
# whole design:
#
#   deficit risk   judged against P10 — the credible floor. You do not cover a
#                  shortfall against the median, because half the time the
#                  median is optimistic and you are short anyway.
#   surplus        judged against P90 — the credible ceiling. Curtailment and
#                  storage decisions have to be sized for the high case, since
#                  a battery that is full when the peak arrives is useless.
#   energy         accounted against P50. Revenue and MWh totals want the
#                  central estimate, not a bound.


RiskLevel = Literal["good", "watch", "serious", "critical"]

ActionType = Literal[
    "battery_charge",
    "battery_discharge",
    "curtail",
    "gas_peaker",
    "diesel",
    "demand_shift",
]


class BlockDecision(BaseModel):
    """One block, assessed against what was promised and what can be exported."""

    block: int = Field(ge=1, le=96)
    label: str
    timestamp: datetime
    locked: bool
    """True when this block sits before the revision horizon — the forecast may
    have moved, but no schedule revision issued now can reach it. The UI dims
    these rather than hiding them: what you can no longer change still explains
    the deviation you are about to be charged for."""

    p10: float
    p50: float
    p90: float
    schedule_mw: float
    """Declared capability for this block — what the plant told the load
    despatcher it would deliver."""

    deviation_mw: float
    """P50 minus schedule. Signed: negative is under-delivery."""

    deficit_mw: float = Field(ge=0)
    """max(0, schedule − P10). The shortfall that must be covered in the
    credible worst case."""

    surplus_mw: float = Field(ge=0)
    """max(0, P90 − schedule). Generation above what was requisitioned."""

    curtailment_mw: float = Field(ge=0)
    """max(0, P90 − evacuation limit). Energy the grid physically cannot take,
    which is a different problem from energy nobody asked for."""

    risk: RiskLevel
    severity: int = Field(default=0, ge=0, le=100)
    """0–100 operational severity score."""
    driver: str | None = None
    """Human-readable physical driver explanation."""

    headroom_mw: float
    """Evacuation limit minus P50. Negative means congestion at the median."""


class RecommendedAction(BaseModel):
    """A contiguous run of blocks with one instruction.

    Grouped deliberately. Nine consecutive rows saying "charge 100 MW" is data;
    "Charge 100 MW, blocks 44–52, 225 MWh" is an instruction someone can carry
    out.
    """

    action: ActionType
    block_start: int = Field(ge=1, le=96)
    block_end: int = Field(ge=1, le=96)
    label: str
    """Pre-rendered '11:00–13:00' span."""

    magnitude_mw: float
    energy_mwh: float
    cost_inr: float
    """Cost of taking this action. Negative is a saving — battery charging
    against curtailment earns more than it costs."""

    co2_tonnes: float
    """Emissions consequence. Negative is avoided emissions."""

    rationale: str
    actionable: bool
    """False when the run lies entirely inside the locked window. Shown anyway,
    marked, because the honest answer to 'why am I paying a deviation charge' is
    often 'this was visible four blocks ago and nothing could be done'."""


class RiskEvent(BaseModel):
    """Grouped risk event with operational severity and data-grounded driver attribution."""

    event_type: Literal["deficit", "surplus", "curtailment"]
    block_start: int = Field(ge=1, le=96)
    block_end: int = Field(ge=1, le=96)
    label: str
    """Pre-rendered span, e.g. '18:30–21:00'."""

    peak_deviation_mw: float
    energy_mwh: float
    severity: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    driver: str
    """Clear, plain-language explanation of why the event occurred."""
    driver_detail: str | None = None
    """Supporting telemetry clue (solar elevation, cloud %, wind threshold)."""
    recommended_action: str | None = None
    actionable: bool = True


class DecisionResponse(BaseModel):
    site: Site
    despatch_date: str
    issued_at: datetime
    current_block: int = Field(ge=1, le=96)
    revision_horizon_block: int = Field(ge=1, le=96)

    schedule_basis: str
    """How the declared-capability curve was obtained. On this deployment it is
    simulated from a day-ahead forecast run, and saying so in the payload means
    the UI cannot accidentally present it as a filed schedule."""

    blocks: list[BlockDecision]
    actions: list[RecommendedAction]
    events: list[RiskEvent] = Field(default_factory=list)
    """Detected operational risk events ranked by severity."""

    deficit_energy_mwh: float
    surplus_energy_mwh: float
    curtailment_energy_mwh: float
    net_cost_inr: float
    net_co2_tonnes: float
    worst_block: int | None = None
    """Block with the largest absolute deviation. The one to look at first."""

    headline: str
    """One sentence for the top of the page, written server-side so the number
    and the sentence cannot disagree."""


# ═════════════════════════════════════════════════════════════════════════
# ERRORS
# ═════════════════════════════════════════════════════════════════════════


class ErrorResponse(BaseModel):
    """Errors say what happened and what to do next, in the interface's voice.

    `detail` is written to be shown to a user verbatim — no stack traces, no
    'an error occurred'.
    """

    error: str
    detail: str
    hint: str | None = None


# ═════════════════════════════════════════════════════════════════════════
# ACCURACY
# ═════════════════════════════════════════════════════════════════════════


class TechnologyAccuracy(BaseModel):
    """Validation metrics for one technology's model.

    `skill_pct` is the improvement over Stage A physics alone. It is the only
    honest measure of what the ML stage contributes: a model can post a fine
    MAE while adding nothing to a physics baseline that was already good.
    """

    technology: Technology
    rows_train: int
    rows_valid: int
    n_features: int

    mae_mw: float
    mae_mw_physics: float
    nmae_pct: float
    nmae_pct_physics: float
    skill_pct: float
    rmse_mw: float

    pi_coverage: float
    """Share of actuals that fell inside P10–P90. Should sit near nominal."""
    pi_nominal: float
    mean_interval_width_mw: float


class AccuracyResponse(BaseModel):
    model_version: str
    trained_at: str
    ground_truth: str
    """How the target was produced. Stated because it bounds every claim
    below it."""
    quantiles: list[float]
    technologies: list[TechnologyAccuracy]


# ═════════════════════════════════════════════════════════════════════════
# COPILOT
# ═════════════════════════════════════════════════════════════════════════


class CopilotRequest(BaseModel):
    site_id: str
    question: str = Field(min_length=1, max_length=500)


class CopilotResponse(BaseModel):
    answer: str
    mode: Literal["gemini", "deterministic"]
    """Which engine produced this. Shown in the UI — a rule-based answer must
    never be able to pass as a model-generated one, or the reverse."""
    grounded_on: str
    """The exact fact block the answer was written from. Every number in the
    answer appears here; the model is never asked to compute one."""


# ═════════════════════════════════════════════════════════════════════════
# SIMULATOR
# ═════════════════════════════════════════════════════════════════════════


class SimulatorRequest(BaseModel):
    site_id: str = "bhadla"
    # Battery controls
    battery_power_mw: float | None = Field(default=None, ge=0, description="Battery power rating in MW")
    battery_energy_mwh: float | None = Field(default=None, ge=0, description="Battery storage capacity in MWh")
    battery_initial_soc_pct: float | None = Field(default=None, ge=0, le=100, description="Initial State of Charge %")
    battery_rte_pct: float | None = Field(default=None, ge=50, le=100, description="Round-trip efficiency %")
    # Flexible demand
    flexible_demand_mw: float = Field(default=0.0, ge=0, description="Flexible demand shift capability in MW")
    # Backup
    backup_capacity_mw: float | None = Field(default=None, ge=0, description="Peaking backup capacity in MW")
    backup_notice_hours: float = Field(default=0.0, ge=0, le=24, description="Lead notice hours required before backup can start")
    # Grid
    evacuation_limit_mw: float | None = Field(default=None, gt=0, description="Grid export / evacuation limit in MW")
    # Economics
    tariff_per_mwh: float | None = Field(default=None, ge=0, description="PPA tariff in ₹/MWh")
    gas_peaker_cost_per_mwh: float | None = Field(default=None, ge=0, description="Gas peaker generation cost in ₹/MWh")
    diesel_cost_per_mwh: float | None = Field(default=None, ge=0, description="Diesel generation cost in ₹/MWh")
    grid_emission_factor: float | None = Field(default=None, ge=0, description="Grid emission factor in tCO2/MWh")


class SimulationMetrics(BaseModel):
    served_energy_mwh: float
    curtailed_energy_mwh: float
    unserved_energy_mwh: float
    net_cost_inr: float
    net_co2_tonnes: float
    deficit_energy_mwh: float = 0.0
    surplus_energy_mwh: float = 0.0


class SimulationDeltas(BaseModel):
    served_energy_mwh: float
    curtailed_energy_mwh: float
    unserved_energy_mwh: float
    net_cost_inr: float
    net_co2_tonnes: float


class AttributionItem(BaseModel):
    lever: str
    unserved_delta_mwh: float
    curtailed_delta_mwh: float
    cost_delta_inr: float
    co2_delta_tonnes: float


class BreakEvenResult(BaseModel):
    feasible: bool
    minimum_power_mw: float
    minimum_energy_mwh: float
    message: str


class SimulatorTimelineBlock(BaseModel):
    block: int = Field(ge=1, le=96)
    label: str
    schedule_mw: float
    baseline_dispatch_mw: float
    scenario_dispatch_mw: float
    baseline_unserved_mw: float
    scenario_unserved_mw: float
    evacuation_limit_mw: float


class SimulatorResponse(BaseModel):
    site_id: str
    site_name: str
    capacity_mw: float
    baseline_config: dict[str, Any]
    scenario_config: dict[str, Any]
    baseline: SimulationMetrics
    scenario: SimulationMetrics
    deltas: SimulationDeltas
    primary_message: str
    break_even: BreakEvenResult
    attribution: list[AttributionItem]
    actions: list[RecommendedAction]
    timeline: list[SimulatorTimelineBlock] = Field(default_factory=list)


class SimulatorDefaultsResponse(BaseModel):
    site_id: str
    site_name: str
    capacity_mw: float
    defaults: dict[str, Any]


# ═════════════════════════════════════════════════════════════════════════
# INGEST & HISTORY
# ═════════════════════════════════════════════════════════════════════════


class SkippedRowDetail(BaseModel):
    row_index: int
    raw_timestamp: str
    raw_generation: str
    reason: str


class IngestPreviewRow(BaseModel):
    row_index: int
    raw_timestamp: str
    raw_generation: str
    parsed_ts: str | None = None
    block: int | None = None
    generation_mw: float | None = None
    valid: bool
    errors: list[str] = Field(default_factory=list)


class IngestValidateResponse(BaseModel):
    site_id: str
    site_name: str
    capacity_mw: float
    technology: Technology
    headers: list[str]
    detected_mapping: dict[str, str | None]
    preview_rows: list[IngestPreviewRow]
    total_rows: int
    valid_rows_count: int
    invalid_rows_count: int
    resolution: str
    date_range_start: str | None = None
    date_range_end: str | None = None
    is_chronological: bool = True
    duplicate_count: int = 0
    summary_message: str


class IngestResponse(BaseModel):
    site_id: str
    site_name: str
    capacity_mw: float
    technology: Technology
    imported_rows: int
    skipped_rows: int
    resolution: str
    date_range_start: str | None = None
    date_range_end: str | None = None
    message: str
    skipped_rows_data: list[SkippedRowDetail] = Field(default_factory=list)


class HistoryResponse(BaseModel):
    site_id: str
    site_name: str
    capacity_mw: float
    technology: Technology
    actuals_count: int
    date_range_start: str | None = None
    date_range_end: str | None = None
    scored_blocks_count: int = 0
    recent_actuals: list[dict[str, Any]] = Field(default_factory=list)


__all__ = [
    "AccuracyResponse",
    "ActionType",
    "AttributionItem",
    "BlockDecision",
    "BreakEvenResult",
    "CopilotRequest",
    "CopilotResponse",
    "DecisionResponse",
    "EnergySummary",
    "ErrorResponse",
    "ForecastBlock",
    "ForecastResponse",
    "HealthResponse",
    "HistoryResponse",
    "IngestPreviewRow",
    "IngestResponse",
    "IngestValidateResponse",
    "RecommendedAction",
    "RiskEvent",
    "RiskLevel",
    "SimulationDeltas",
    "SimulationMetrics",
    "SimulatorDefaultsResponse",
    "SimulatorRequest",
    "SimulatorResponse",
    "SimulatorTimelineBlock",
    "Site",
    "SiteListResponse",
    "SkippedRowDetail",
    "Technology",
    "TechnologyAccuracy",
]

