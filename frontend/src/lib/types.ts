/**
 * API types — the mirror of `backend/app/schemas.py`.
 *
 * Hand-written rather than generated. The backend's OpenAPI schema is
 * available at /api/openapi.json and codegen would work, but a generated
 * file is one more build step for a 24-hour project and these shapes are
 * small enough to keep honest by hand. If they grow, generate them.
 */

export type Technology = "solar" | "wind";
export type Tracking = "fixed" | "single_axis";

export interface SolarParams {
  tilt_deg: number;
  azimuth_deg: number;
  tracking: Tracking;
  dc_ac_ratio: number;
  system_losses: number;
  inverter_efficiency: number;
}

export interface WindParams {
  hub_height_m: number;
  rotor_diameter_m: number;
  turbine_class: string;
  n_turbines: number;
  shear_exponent: number;
  wake_loss: number;
  availability: number;
}

export interface BatterySpec {
  power_mw: number;
  energy_mwh: number;
  initial_soc: number;
}

export interface Site {
  id: string;
  name: string;
  state: string;
  technology: Technology;
  latitude: number;
  longitude: number;
  elevation_m: number;
  capacity_mw: number;
  /** Below nameplate at every large park — the reason surplus becomes
   *  curtailment rather than revenue. */
  evacuation_limit_mw: number;
  commissioned_year: number;
  tariff_per_mwh: number;
  solar: SolarParams | null;
  wind: WindParams | null;
  battery: BatterySpec | null;
}

export interface SiteListResponse {
  sites: Site[];
  count: number;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  server_time_ist: string;
  current_block: number;
  revision_horizon_block: number;
  /** False means physics-only forecasts. The UI says so rather than
   *  pretending the ML stage ran. */
  models_loaded: boolean;
  copilot_mode: "gemini" | "deterministic";
}

export interface ForecastBlock {
  block: number;
  timestamp: string;
  label: string;
  lead_hours: number;
  /** Deficit risk is judged against p10, surplus against p90, and energy
   *  accounting against p50. The three are not interchangeable. */
  p10: number;
  p50: number;
  p90: number;
  physics_mw: number;
  capacity_factor: number;
  is_daylight: boolean;
}

export interface ForecastResponse {
  site: Site;
  issued_at: string;
  despatch_date: string;
  horizon_hours: number;
  blocks: ForecastBlock[];
  current_block: number;
  revision_horizon_block: number;
  weather_source: string;
  model_version: string;
  degraded: boolean;
  notes: string[];
}

export interface EnergySummary {
  /** Site identity travels with the numbers. The fleet endpoint omits sites
   *  whose forecast failed, so list position is not a key back to the
   *  registry — a dropped site would shift every later row onto a wrong name. */
  site_id: string;
  site_name: string;
  technology: Technology;
  capacity_mw: number;
  mwh_p10: number;
  mwh_p50: number;
  mwh_p90: number;
  peak_mw: number;
  peak_block: number;
  mean_capacity_factor: number;
}

export interface ErrorResponse {
  error: string;
  detail: string;
  hint: string | null;
}

/* ═══════════════════════════════════════════════════════════════════════
   DECISIONS

   The asymmetry between the three quantiles is the design, not an
   implementation detail: deficit is judged against p10 (the credible floor),
   surplus and curtailment against p90 (the credible ceiling), and energy
   accounting against p50. Reading any of them off the wrong quantile is the
   mistake this shape exists to prevent.
   ═══════════════════════════════════════════════════════════════════════ */

export type RiskLevel = "good" | "watch" | "serious" | "critical";

export type ActionType =
  | "battery_charge"
  | "battery_discharge"
  | "curtail"
  | "gas_peaker"
  | "diesel"
  | "hold";

export interface BlockDecision {
  block: number;
  label: string;
  timestamp: string;
  /** Before the revision horizon: the forecast may have moved, but no
   *  revision issued now can reach this block. Dimmed, never hidden. */
  locked: boolean;
  p10: number;
  p50: number;
  p90: number;
  /** Declared capability — what the plant told the despatcher it would
   *  deliver. Simulated on this deployment; see `schedule_basis`. */
  schedule_mw: number;
  deviation_mw: number;
  deficit_mw: number;
  surplus_mw: number;
  curtailment_mw: number;
  risk: RiskLevel;
  /** Evacuation limit minus p50. Negative means congestion at the median. */
  headroom_mw: number;
}

export interface RecommendedAction {
  action: ActionType;
  block_start: number;
  block_end: number;
  label: string;
  magnitude_mw: number;
  energy_mwh: number;
  /** Negative is a saving. Charging a battery against curtailment earns more
   *  than it costs, which is the point of the merit order. */
  cost_inr: number;
  co2_tonnes: number;
  rationale: string;
  /** False when the run lies entirely inside the locked window. */
  actionable: boolean;
}

export interface DecisionResponse {
  site: Site;
  despatch_date: string;
  issued_at: string;
  current_block: number;
  revision_horizon_block: number;
  /** How the declared-capability curve was obtained. Carried in the payload
   *  so the UI cannot accidentally present a simulation as a filed schedule. */
  schedule_basis: string;
  blocks: BlockDecision[];
  actions: RecommendedAction[];
  deficit_energy_mwh: number;
  surplus_energy_mwh: number;
  curtailment_energy_mwh: number;
  net_cost_inr: number;
  net_co2_tonnes: number;
  worst_block: number | null;
  headline: string;
}

/* ═══════════════════════════════════════════════════════════════════════
   ACCURACY AND COPILOT
   ═══════════════════════════════════════════════════════════════════════ */

export interface TechnologyAccuracy {
  technology: Technology;
  rows_train: number;
  rows_valid: number;
  n_features: number;
  mae_mw: number;
  mae_mw_physics: number;
  nmae_pct: number;
  nmae_pct_physics: number;
  /** Improvement over physics alone — the only honest measure of what the ML
   *  stage contributes. */
  skill_pct: number;
  rmse_mw: number;
  /** Share of actuals inside P10–P90. Should sit near nominal. */
  pi_coverage: number;
  pi_nominal: number;
  mean_interval_width_mw: number;
}

export interface AccuracyResponse {
  model_version: string;
  trained_at: string;
  /** How the target was produced. Bounds every claim below it. */
  ground_truth: string;
  quantiles: number[];
  technologies: TechnologyAccuracy[];
}

export interface CopilotResponse {
  answer: string;
  /** Shown in the UI — a rule-based answer must never pass as model-generated. */
  mode: "gemini" | "deterministic";
  grounded_on: string;
}
