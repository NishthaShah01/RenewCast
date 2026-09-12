# RenewCast — Project Flow & Architecture

**AI-Powered Renewable Generation Forecasting Platform**
HackOut'26 · Theme: Renewable Energy Intelligence · Team TriHack · L.D. College of Engineering

> This document is the **build contract**. It defines what we are making, how data moves through the
> system, what every module is responsible for, the exact API surface, and **what you must do by hand**.
> UI specification lives in a separate document: `README_UI.md`.

---

## Table of contents

1. [The product in one page](#1-the-product-in-one-page)
2. [Why this beats a plain forecasting dashboard](#2-why-this-beats-a-plain-forecasting-dashboard)
3. [System architecture](#3-system-architecture)
4. [End-to-end data flow](#4-end-to-end-data-flow)
5. [Data strategy — sources, roles, licences](#5-data-strategy--sources-roles-licences)
6. [The forecasting engine (Stage A physics ⊕ Stage B ML)](#6-the-forecasting-engine)
7. [The decision engine (Detect → Decide → Quantify)](#7-the-decision-engine)
8. [The what-if simulator](#8-the-what-if-simulator)
9. [The AI Copilot (grounded, key-optional)](#9-the-ai-copilot)
10. [API contract](#10-api-contract)
11. [Data model & storage](#11-data-model--storage)
12. [Repository layout](#12-repository-layout)
13. [Configuration & environment variables](#13-configuration--environment-variables)
14. [🔴 WHAT YOU MUST DO MANUALLY](#14--what-you-must-do-manually)
15. [Phased build plan](#15-phased-build-plan)
16. [Team split (3 people)](#16-team-split-3-people)
17. [Deployment](#17-deployment)
18. [Risk register & fallbacks](#18-risk-register--fallbacks)
19. [Judging-criteria traceability](#19-judging-criteria-traceability)
20. [Demo script (3 minutes)](#20-demo-script-3-minutes)

---

## 1. The product in one page

RenewCast is a **grid-operations decision platform**, not a weather widget.

For a chosen renewable plant it answers four questions in sequence:

| # | Question | Stage | Output |
|---|----------|-------|--------|
| 1 | *How much power will this plant produce for the next 24 / 48 / 72 hours?* | **Forecast** | Hourly P10 / P50 / P90 MW curve |
| 2 | *When does that become a grid problem?* | **Detect** | Ranked risk events with severity + driver attribution |
| 3 | *What should the operator actually do?* | **Decide** | Merit-ordered action plan with an hour-by-hour dispatch schedule |
| 4 | *What does each choice cost in energy, money and carbon?* | **Quantify** | MWh · ₹ · tCO₂ deltas, plus residual unserved energy |
| 5 | *Explain it to me in plain language.* | **Explain** | Grounded narrative + conversational Q&A |

The five stages map 1:1 to the problem statement's three asks — *forecast 24–72h*, *flag over/under-generation*,
*recommend grid actions (curtailment, storage dispatch, backup activation)* — and then go one layer past them.

### The headline demo claim

> "This is not a replay of a CSV. This is the **real forecast for Bhadla Solar Park for the next 72 hours**,
> generated from live ECMWF weather, with honest uncertainty bands, and it tells the operator what to do about it."

---

## 2. Why this beats a plain forecasting dashboard

Most hackathon entries for this statement will do: load CSV → fit Prophet/LSTM → draw line chart → done.
Four decisions separate us.

### 2.1 We do not use target-lag features — and that is a feature, not a limitation

The obvious approach is `y(t) = f(y(t-1), y(t-2), rolling_mean(y), hour, month)`.
It scores beautifully in a naive backtest and is **useless in production at a 72-hour horizon**, because at
issue time you do not have `y(t-1)` for a point 71 hours away. Any model that consumes recent actuals is only
valid for the first 1–3 hours; beyond that the lags must be recursively imputed and error explodes.

RenewCast is **weather-driven**: every feature at target time *t* is derivable from the NWP forecast plus
astronomy plus static site metadata. The model is therefore **equally valid at hour 1 and hour 72**, and the
backtest number we quote is the number an operator would actually get.

**Say this on stage.** It is the single most credible thing in the whole project.

### 2.2 We train on archived *forecasts*, not on reanalysis

Subtle but decisive. If you train the weather→power mapping on ERA5 **reanalysis** (what the weather actually
was), the model never sees forecast error, so its uncertainty bands are far too narrow and it silently lies
about confidence at 72h.

We train primarily on Open-Meteo's **Historical Forecast API** — archived ECMWF/HRES *model runs* as they were
issued — so the model learns to correct real NWP bias **at real lead times**. `lead_hours` is an explicit
feature, which is why P10–P90 correctly widens as the horizon extends.

### 2.3 Physics first, ML second

Stage A is a deterministic solar-geometry + PV-performance + turbine-power-curve model. It needs **zero
training data** and it always produces a plausible curve. Stage B (gradient-boosted quantile trees) learns the
*correction* — soiling, inverter clipping, wake losses, availability, curtailment.

Two payoffs: (a) the demo can never render an empty chart even if training fails, and (b) the model transfers
to a plant it has never seen, because physics handles geography and ML handles conversion loss.

### 2.4 Uncertainty is a first-class citizen

We predict three quantiles, not a point. Every downstream decision uses the *right* quantile:
- **deficit risk** is assessed against **P10** (pessimistic — the operator must cover the bad case)
- **curtailment risk** is assessed against **P90** (optimistic — the grid must absorb the good case)
- **energy accounting** uses **P50**

Using a single point estimate for all three is the most common mistake in this problem space.

---

## 3. System architecture

```
┌──────────────────────────────────── EXTERNAL DATA ────────────────────────────────────┐
│                                                                                       │
│  Open-Meteo FORECAST API          Open-Meteo HISTORICAL-FORECAST API                  │
│  (live 72h NWP, no key)           (archived model runs 2022→, no key)                 │
│                                                                                       │
│  Open-Meteo ARCHIVE / ERA5        Open Power System Data           ARPA-E PERFORM     │
│  (reanalysis fallback, no key)    (real measured MW, no key)       (US BA, no key)    │
└───────────────────────────────────────────────────────────────────────────────────────┘
                    │                          │                          │
              live inference              model training            2nd ingest adapter
                    │                          │                          │
                    ▼                          ▼                          ▼
┌───────────────────────────── BACKEND · Python / FastAPI ──────────────────────────────┐
│                                                                                       │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────────────────┐  │
│  │ INGEST      │→  │ FEATURES     │→  │ FORECAST    │→  │ DECISION ENGINE          │  │
│  │ weather.py  │   │ features.py  │   │ Stage A     │   │ detect  → risk events    │  │
│  │ ingest/*.py │   │ astronomy    │   │ physics.py  │   │ decide  → ranked actions │  │
│  │ file cache  │   │ 40+ leak-    │   │ Stage B     │   │ quantify→ MWh ₹ tCO₂     │  │
│  │             │   │ free feats   │   │ model.py    │   │ dispatch simulation      │  │
│  └─────────────┘   └──────────────┘   │ P10/P50/P90 │   └──────────────────────────┘  │
│                                       └─────────────┘                │                │
│  ┌──────────────────────┐   ┌──────────────────┐   ┌─────────────────▼──────────────┐ │
│  │ SIMULATOR            │   │ BACKTEST         │   │ EXPLAINER                      │ │
│  │ simulator.py         │   │ evaluate.py      │   │ explain.py                     │ │
│  │ battery / flex /     │   │ MAE RMSE nMAE    │   │ ├── deterministic (always on)  │ │
│  │ backup / grid limit  │   │ skill vs 3 base- │   │ └── Gemini adapter (key-opt.)  │ │
│  │ → scenario deltas    │   │ lines, per-lead  │   │ strictly grounded on JSON ctx  │ │
│  └──────────────────────┘   └──────────────────┘   └────────────────────────────────┘ │
│                                                                                       │
│  SQLite (forecast log · actuals · scenarios) + on-disk weather cache                  │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                       │  REST / JSON
                                       ▼
┌──────────────────────── FRONTEND · Next.js 15 + TypeScript ───────────────────────────┐
│  Command Center · Forecast Studio · Risk & Actions · What-If Simulator                │
│  Fleet View · Model Accuracy · AI Copilot            (full spec → README_UI.md)       │
│  Tailwind · shadcn/ui · Recharts · Framer Motion · TanStack Query                     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Why this stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend | **Python + FastAPI** | ML lives where the libraries are; auto-generated OpenAPI docs are a free "look, real engineering" moment for judges |
| Model | **LightGBM quantile** (fallback `sklearn.HistGradientBoostingRegressor`) | Trains in seconds on tabular features, native quantile objective, no GPU. A 24h window has no room for LSTM babysitting |
| Frontend | **Next.js 15 App Router + TS** | One deploy target, server components for fast first paint, matches the ideation report |
| Charts | **Recharts** | Composed-chart support for the P10–P90 band + reference lines; far faster to build than raw D3 |
| State | **TanStack Query** | Free caching/refetch/loading states for every endpoint — removes ~200 lines of boilerplate |
| Store | **SQLite + parquet cache** | Zero-setup persistence. No Supabase, no auth, no migrations |
| LLM | **Gemini via REST, key-optional** | No SDK version risk; deterministic fallback means the demo cannot break |

**Explicitly rejected:** Supabase/auth (zero judge points, ~4h cost), Prophet (weak with exogenous weather
regressors, slow to fit per-site), LSTM (needs more data + tuning time than we have), blockchain (wrong problem
statement), Docker for local dev (adds friction on Windows).

---

## 4. End-to-end data flow

### 4.1 Offline — once, before the demo (`scripts/`)

```
 [1] build_dataset.py
     ├── download OPSD 60-min time series          → real measured MW + capacity
     ├── derive capacity factor  cf = gen / capacity ∈ [0,1]
     ├── for each training zone (4 German TSO zones + optional Elia/Belgium):
     │      fetch archived FORECASTS at zone centroid (Historical Forecast API)
     │      for lead buckets {6,12,24,36,48,72} h
     ├── join weather ⟵ timestamp ⟶ cf
     └── write  data/processed/train_solar.parquet
                data/processed/train_wind.parquet

 [2] train.py
     ├── chronological split (NEVER random — that leaks the future)
     │      train ≤ 2023-06-30 | val 2023-07→2023-12 | test 2024+
     ├── fit 3 quantile models per technology  (α = 0.10 / 0.50 / 0.90)
     ├── evaluate vs 3 baselines: climatology · persistence · pure-physics
     ├── calibrate quantiles (empirical coverage → target 80% PI coverage)
     └── write  models/solar_q{10,50,90}.joblib
                models/wind_q{10,50,90}.joblib
                models/metrics.json          ← powers the Accuracy page
                models/model_card.json       ← powers /api/model/card
```

> `models/*` is **committed to git** so the deployed backend never trains at boot.

### 4.2 Online — every dashboard load

```
 GET /api/forecast/bhadla-solar?horizon_hours=72
   │
   ├─ 1. site lookup            sites.py → lat, lon, capacity_mw, tech, tilt, turbine class
   ├─ 2. weather fetch          weather.py → Open-Meteo forecast (file-cached 30 min)
   ├─ 3. astronomy              solar zenith/azimuth per hour from lat/lon/UTC (no API)
   ├─ 4. Stage A physics        physics.py → clear-sky GHI, POA, cell temp, physics_cf
   ├─ 5. feature matrix         features.py → 40+ leak-free columns incl. lead_hours
   ├─ 6. Stage B ML             model.py → cf_p10, cf_p50, cf_p90  (monotonic sort enforced)
   ├─ 7. de-normalise           MW = cf × capacity_mw × availability
   ├─ 8. log the run            store.py → forecast_runs + forecast_points  (enables
   │                                        the forecast-vs-actual history page)
   └─ 9. respond                hourly series + weather drivers + model version
```

```
 GET /api/actions/bhadla-solar?horizon=72
   │
   ├─ forecast (above, memoised)
   ├─ demand / schedule curve  ← site commitment profile
   ├─ detect_events()          → contiguous deficit (vs P10) & surplus (vs P90) runs
   ├─ attribute_drivers()      → "clear-sky index 0.31 ⇒ dense cloud", "v₁₀₀ 2.1 m/s < cut-in 3.0"
   ├─ rank_actions()           → merit order by ₹/MWh-resolved, then tCO₂, then feasibility
   ├─ simulate_dispatch()      → hour-by-hour battery SoC walk, residual unserved energy
   └─ quantify()               → MWh · ₹ · tCO₂ per action + "cost of acting late" delta
```

---

## 5. Data strategy — sources, roles, licences

Per your decision we use **both** the live-API spine *and* ARPA-E PERFORM, layered by role.

| Source | Endpoint / file | Role | Key | Licence |
|--------|-----------------|------|-----|---------|
| **Open-Meteo Forecast** | `api.open-meteo.com/v1/forecast` | **Live 72h inference** — GHI, DNI, DHI, cloud layers, T, RH, pressure, v₁₀/v₁₀₀, gusts, precip | ❌ none | CC-BY 4.0, free non-commercial |
| **Open-Meteo Historical-Forecast** | `historical-forecast-api.open-meteo.com/v1/forecast` | **Primary training weather** — archived model runs ⇒ honest lead-time error | ❌ none | CC-BY 4.0 |
| **Open-Meteo Archive (ERA5)** | `archive-api.open-meteo.com/v1/archive` | Reanalysis fallback + long-run climatology baseline | ❌ none | CC-BY 4.0 |
| **Open Power System Data** | `data.open-power-system-data.org/time_series/latest/` | **Ground truth** — real *measured* hourly solar & wind MW + installed capacity + ready-made `*_profile` capacity factors, 4 German TSO zones, multi-year | ❌ none | MIT / CC-BY |
| **ARPA-E PERFORM** (NREL/OEDI) | `data.openei.org/submissions/5959` | **Second ingest adapter** — US balancing-area 5-min solar/wind/load with *actual + vendor forecast*, lets us benchmark against a real published forecast and proves the "location-agnostic ingestion" claim | ❌ none | Public domain (US DOE) |
| **Elia Open Data** *(optional)* | `opendata.elia.be/api/…` | Stretch: Belgian TSO publishes actual **and** its own day-ahead forecast → head-to-head comparison | ❌ none | Open |

**Zero API keys for the entire data layer.** The only optional key in the project is Gemini.

### 5.1 The honesty problem, stated plainly

We train on European/US measured generation because **no clean, free, site-level Indian generation time series
exists** at hackathon-accessible quality. We therefore:

1. train in **capacity-factor space** (dimensionless), so nothing is tied to a specific plant size;
2. let **Stage A physics** carry all location dependence (solar geometry, irradiance, air density are computed
   correctly for Bhadla's actual latitude);
3. ship a **`POST /api/ingest/csv`** endpoint so a real Indian operator can upload their own actuals and
   re-fit in minutes;
4. **state this limitation openly** in the Model Card page and in the pitch.

Judges reward a team that names its own limitation before they find it. Teams that hide it get destroyed in Q&A.

### 5.2 Site registry (ships with the app)

| Site ID | Name | State | Lat | Lon | Capacity | Tech |
|---------|------|-------|-----|-----|----------|------|
| `bhadla-solar` | Bhadla Solar Park | Rajasthan | 27.54 | 71.92 | 2245 MW | Solar PV |
| `pavagada-solar` | Pavagada (Shakti Sthala) | Karnataka | 14.10 | 77.28 | 2050 MW | Solar PV |
| `charanka-solar` | Charanka / Gujarat Solar Park | Gujarat | 23.90 | 71.20 | 790 MW | Solar PV |
| `muppandal-wind` | Muppandal Wind Farm | Tamil Nadu | 8.26 | 77.55 | 1500 MW | Wind onshore |
| `jaisalmer-wind` | Jaisalmer Wind Park | Rajasthan | 26.91 | 70.92 | 1064 MW | Wind onshore |

Each record also carries: tilt, azimuth, module temp coefficient, performance ratio, turbine class
(cut-in 3.0 / rated 12.0 / cut-out 25.0 m/s), hub height, grid evacuation limit, PPA tariff, battery + backup
asset config, and a demand/commitment profile. All of it is user-editable from the UI.

---

## 6. The forecasting engine

### 6.1 Stage A — deterministic physics (`core/physics.py`)

**Solar chain**
```
timestamp + lat/lon        → solar declination, hour angle, zenith θz, azimuth
extraterrestrial radiation → clear-sky GHI  (Haurwitz / simplified Ineichen)
clear-sky index  kt        = GHI_forecast / GHI_clearsky          ← the key cloud signal
GHI, DNI, DHI + tilt β     → POA irradiance (isotropic transposition + ground albedo 0.2)
T_air, POA, v₁₀            → cell temperature (NOCT / Faiman model)
                           → P = Pdc0 · (POA/1000) · [1 + γ(Tcell − 25)] · PR · (1 − soiling)
                           → inverter clipping at AC rating, then cf_physics = P / capacity
```

**Wind chain**
```
v₁₀, v₁₀₀                  → shear exponent α = ln(v₁₀₀/v₁₀) / ln(100/10)
                           → extrapolate to hub height
T, surface_pressure        → air density ρ = P/(R·T)
                           → density-corrected speed  v_eq = v_hub · (ρ/1.225)^(1/3)
v_eq + turbine class       → piecewise power curve:
                               v < 3.0            → 0
                               3.0 ≤ v < 12.0     → cubic ramp, Cp-limited
                               12.0 ≤ v < 25.0    → rated
                               v ≥ 25.0           → 0   (storm shutdown)
                           → × (1 − wake loss) × availability → cf_physics
```

The storm-shutdown cliff is a great demo moment: a high-wind hour that produces **zero** output is
counter-intuitive and shows the model understands turbines, not just correlations.

### 6.2 Stage B — ML quantile correction (`core/model.py`)

**Target:** measured capacity factor ∈ [0, 1].
**Estimator:** LightGBM `objective="quantile"`, `alpha ∈ {0.10, 0.50, 0.90}`, ~400 trees, depth 6, lr 0.05.
**Fallback:** `sklearn.ensemble.HistGradientBoostingRegressor(loss="quantile")` — same algorithm family, ships
with scikit-learn, so a LightGBM wheel problem on Python 3.14 cannot block us.

**Feature groups (all leak-free):**

| Group | Features |
|-------|----------|
| Astronomy | `cos_zenith`, `sin_azimuth`, `cos_azimuth`, `is_day`, `airmass`, `sunrise/sunset_offset_h` |
| Calendar | `hour_sin/cos`, `doy_sin/cos` (no raw month — avoids step artefacts) |
| Horizon | **`lead_hours`** — teaches the model that skill decays with lead time |
| Irradiance (solar) | `ghi`, `dni`, `dhi`, `clearsky_ghi`, **`clearsky_index`**, `poa_global`, `ghi_roll3_mean`, `ghi_roll3_std` |
| Cloud | `cloud_cover`, `_low`, `_mid`, `_high`, `cloud_cover_delta_1h` |
| Thermal | `temperature_2m`, `cell_temp`, `dew_point`, `relative_humidity` |
| Wind | `v10`, `v100`, `shear_alpha`, `gust`, `turbulence_proxy`, `air_density`, `v_eq`, `v100_cubed`, `dir_sin/cos`, `v100_roll3_mean/std` |
| Precip | `precipitation`, `rain`, `snowfall` (rain ⇒ panel cleaning ⇒ next-day uplift) |
| Physics | **`cf_physics`** — Stage A output as a feature (residual learning) |
| Static | `latitude`, `tilt`, `performance_ratio`, `hub_height`, `tech_onehot` |

**Rolling windows are over *weather*, never over the target** — that is what keeps it leak-free.

### 6.3 Baselines we must beat (non-negotiable for credibility)

| Baseline | Definition | Why it matters |
|----------|------------|----------------|
| **Climatology** | mean cf per (hour-of-day, month) | The "do nothing smart" bar |
| **Persistence** | cf(t) = cf(t − 24h) | What many operators actually use |
| **Pure physics** | Stage A alone, no ML | Proves the ML layer earns its place |

**Reported metrics:** MAE, RMSE, nMAE (% of capacity), MAPE on daylight/above-cut-in hours only (MAPE on
zeros is meaningless), **skill score** `1 − MAE_model / MAE_baseline`, **PI coverage** (share of actuals inside
P10–P90; target ≈ 80%), and **per-lead-bucket error** (6/12/24/36/48/72h) so the horizon decay is visible.

> Realistic target: nMAE **4–7%** of capacity for solar day-ahead, **8–14%** for wind, with **25–45% skill**
> over persistence. If we hit that, we are in genuine industry territory. We will publish whatever we actually
> get — real numbers, no inflation.

---

## 7. The decision engine

`core/decision.py` — pure, deterministic, unit-testable. **No LLM touches these numbers.**

### 7.1 Detect

Per hour *i*, with demand/commitment `D`, grid evacuation limit `L`, capacity `C`:

```
deficit_i  = max(0, D_i − P10_i)                      # under-generation → reliability risk
surplus_i  = max(0, P90_i − min(D_i + export_i, L_i)) # over-generation  → curtailment risk
ramp_i     = |P50_i − P50_{i−1}|                      # ramp-rate stress
width_i    = P90_i − P10_i                            # forecast uncertainty
```

Events = contiguous runs where the metric exceeds a threshold (default 2% of capacity) for ≥ 2 hours.
Adjacent runs separated by a single hour are merged.

**Severity score** (0–100):
```
severity = 100 · w₁·(peak_MW / C) + w₂·min(duration_h/6, 1)
              + w₃·tod_criticality(hour)      # 18:00–23:00 evening peak weighted highest
              + w₄·(width / C)                # high uncertainty ⇒ higher operational risk
      → LOW < 25 ≤ MEDIUM < 50 ≤ HIGH < 75 ≤ CRITICAL
```

**Driver attribution** — rule-based on physics inputs, so every alert is explainable without SHAP:
- `clearsky_index < 0.45` → "dense cloud cover suppressing irradiance"
- `v100 < cut_in` → "wind below turbine cut-in speed (3.0 m/s)"
- `v100 > cut_out` → "storm shutdown — turbines feathered above 25 m/s"
- `cell_temp > 55 °C` → "high-temperature derate on PV modules"
- post-sunset & deficit → "solar ramp-down into evening demand peak"
- `precipitation > 2 mm` → "rain event; expect post-rain output uplift"

### 7.2 Decide — action catalogue

| Action | Trigger | Capability limit | Cost basis |
|--------|---------|------------------|------------|
| `BATTERY_CHARGE` | surplus | `min(surplus, P_batt, (E_max − SoC)/η)` | ~free (absorbs would-be-curtailed energy) |
| `BATTERY_DISCHARGE` | deficit | `min(deficit, P_batt, SoC·η)` | storage LCOS ₹/MWh |
| `DEMAND_SHIFT` | deficit ↔ surplus pair | `flex_MW`, within shift window | incentive ₹/MWh |
| `CURTAIL` | surplus, last resort | unlimited | **lost revenue** = MWh × PPA tariff |
| `BACKUP_START` | residual deficit | `backup_MW`, respects `notice_hours` | fuel ₹/MWh + **tCO₂** |
| `MARKET_SELL` / `MARKET_BUY` | surplus / deficit | exchange liquidity cap | DAM price proxy |
| `RESCHEDULE_MAINTENANCE` | low-generation window | — | opportunity saving |

**Ranking:** merit order by ₹ per MWh-resolved, tie-broken by tCO₂, then by feasibility (notice time available
vs required). Then `simulate_dispatch()` walks the horizon hour by hour, tracking battery SoC and applying
actions in merit order, and reports **residual unserved energy** — the honest "we still could not cover X MWh".

> `BACKUP_START` respecting `notice_hours` is what operationalises your report's line *"late decisions are more
> expensive than decisions made with a few hours of warning."* We compute that delta explicitly and surface it
> as **"Value of this forecast: ₹X saved by deciding now instead of at T−1h."**

### 7.3 Quantify — default coefficients (all editable in the UI)

| Coefficient | Default | Note |
|-------------|---------|------|
| Grid emission factor (India) | 0.71 tCO₂/MWh | CEA order of magnitude — indicative |
| Diesel backup emissions | 0.75 tCO₂/MWh | ≈0.27 L/kWh × 2.68 kgCO₂/L |
| Diesel backup cost | ₹22,000/MWh | ≈₹90/L at 0.27 L/kWh |
| Gas peaker emissions / cost | 0.45 tCO₂/MWh · ₹8,000/MWh | |
| Solar PPA tariff | ₹2,500/MWh | curtailment opportunity cost |
| Wind PPA tariff | ₹3,000/MWh | |
| Battery round-trip η | 88% | |
| Storage LCOS | ₹4,500/MWh | |

Every figure is labelled **"indicative — configurable"** in the UI. Never present an estimate as a measurement.

---

## 8. The what-if simulator

`core/simulator.py` re-runs the **same** `simulate_dispatch()` under a modified asset/price configuration and
diffs the result. Because baseline and scenario share one code path, the comparison is always internally
consistent.

**Levers:** battery power (MW) · battery energy (MWh) · initial SoC (%) · round-trip η · flexible demand (%) ·
backup availability (MW) · backup notice (h) · grid export limit (MW) · PPA tariff · diesel price · carbon price
· forecast confidence stance (plan against P10 / P50 / P90).

**Outputs:** unserved-energy delta · curtailed-energy delta · ₹ delta · tCO₂ delta · a **waterfall** attributing
the saving to each lever · and the break-even answer: *"the smallest battery that removes the 19:00–21:00
deficit entirely is 180 MW / 420 MWh."*

That break-even number is a genuine planning output and a strong closing line for the pitch.

---

## 9. The AI Copilot

**Hard rule: the LLM never produces a number.** It receives already-computed JSON and may only narrate it.
This is exactly the separation your ideation report specifies, and it is also the only defensible design.

```
┌─ context builder (backend) ────────────────────────────────────────────┐
│ { site, horizon, issued_at, model_version,                             │
│   summary: {expected_mwh, peak_mw, min_mw, mean_pi_width},             │
│   events: [...], actions: [...], impact: {mwh, inr, tco2},             │
│   drivers: [...], metrics: {nmae, skill_vs_persistence, pi_coverage} } │
└────────────────────────────────────────────────────────────────────────┘
        │                                              │
   GEMINI_API_KEY set?                            not set?
        ▼                                              ▼
 gemini-3.5-flash-lite via REST               deterministic explainer
 system: "Use ONLY the numbers in            intent router:
 CONTEXT. Never invent or extrapolate.       WHY · WHAT_ACTION · CONFIDENCE
 Cite hour ranges. ≤180 words.               COMPARE · SUMMARY · METRICS
 If unknown, say so."                        → template narrative from the
                                               same JSON context
```

Both paths return `{answer, citations[], grounded_on, mode}` and the UI badges the mode honestly
(`AI · Gemini` vs `Rule-based explainer`). **The demo works with no key at all** — the key is a pure upgrade.

Suggested prompts we ship as chips: *"Why is tomorrow evening risky?"* · *"What should I do first?"* ·
*"How confident are you at 72 hours?"* · *"What if the battery were twice the size?"* ·
*"Summarise the next 24 hours for a trader."*

---

## 10. API contract

Base: `/api` · JSON · CORS open to the frontend origin · OpenAPI docs auto-served at `/docs`.

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| `GET` | `/api/health` | liveness + model version + whether Gemini is configured | **built** |
| `GET` | `/api/sites` | site registry with live current-hour output | **built** |
| `GET` | `/api/sites/{id}` | full site detail: geometry, assets, tariffs, demand profile | **built** |
| `PATCH` | `/api/sites/{id}/config` | edit assets/tariffs/limits from the UI | planned |
| `GET` | `/api/forecast/{id}?horizon_hours=24\|48\|72` | block-level P10/P50/P90 MW, `cf_physics`, weather drivers | **built** |
| `GET` | `/api/forecast/{id}/summary` | energy summary for one site | **built** |
| `GET` | `/api/forecast` | energy summary across all sites | **built** |
| `GET` | `/api/decisions/{id}?horizon_hours=` | ranked actions + dispatch plan + quantified impact + 96-block detail | **built** |
| `GET` | `/api/accuracy` | metrics vs baselines, per-lead-bucket, model card | **built** |
| `POST` | `/api/copilot` | `{site_id, question}` → grounded answer | **built** |
| `GET` | `/api/weather/{id}?horizon=72` | raw NWP series for the Weather Drivers panel | planned — drivers ship inside the forecast response |
| `GET` | `/api/risk/{id}?horizon=72` | detected events: type, window, peak MW, severity, drivers | planned — risk is per block inside `/api/decisions` |
| `GET` | `/api/actions/{id}?horizon=72` | ranked actions | **folded into `/api/decisions/{id}`** |
| `POST` | `/api/simulate` | scenario config → deltas, waterfall, break-even | planned |
| `GET` | `/api/backtest/{tech}` | metrics vs 3 baselines | **folded into `/api/accuracy`** |
| `GET` | `/api/model/card` | features, training data, metrics, **stated limitations** | **folded into `/api/accuracy`** |
| `GET` | `/api/fleet?horizon=72` | portfolio aggregate across all sites | planned — `/api/forecast` covers the aggregate |
| `GET` | `/api/history/{id}` | logged forecast vs actual over time | planned |
| `POST` | `/api/ingest/csv` | upload own plant actuals *(stretch)* | planned |
| `GET` | `/api/ingest/perform/status` | ARPA-E PERFORM adapter availability + BA list | planned |

The query parameter is `horizon_hours`, not `horizon`.

**Canonical forecast response**
```jsonc
{
  "site": { "id": "bhadla-solar", "name": "Bhadla Solar Park", "capacity_mw": 2245, "tech": "solar" },
  "issued_at": "2026-09-12T03:00:00Z",
  "horizon_hours": 72,
  "model": { "version": "solar-lgbm-q-v1", "trained_on": "OPSD+HistForecast", "stage_b": true },
  "series": [
    {
      "ts": "2026-09-12T04:00:00Z", "lead_hours": 1,
      "p10_mw": 0.0, "p50_mw": 0.0, "p90_mw": 0.0,
      "cf_physics": 0.0, "cf_p50": 0.0,
      "weather": { "ghi": 0, "clearsky_index": null, "temp_c": 27.4, "v100_ms": 3.1, "cloud_cover": 12 }
    }
  ],
  "summary": { "expected_mwh": 11840.5, "peak_mw": 1712.3, "peak_ts": "...", "mean_pi_width_mw": 214.8 },
  "disclaimer": "Indicative forecast from public NWP data. Not for live grid dispatch."
}
```

---

## 11. Data model & storage

SQLite at `backend/data/renewcast.db` (created automatically — no migration tooling).

```sql
forecast_runs   (id, site_id, issued_at, horizon_hours, model_version, created_at)
forecast_points (run_id → forecast_runs.id, ts, lead_hours, p10_mw, p50_mw, p90_mw, cf_physics)
actuals         (site_id, ts, mw, source)            -- CSV upload / PERFORM replay
scenarios       (id, site_id, label, payload_json, created_at)
events_log      (id, site_id, run_id, type, start_ts, end_ts, peak_mw, severity, drivers_json)
```

On-disk weather cache: `backend/data/cache/{sha1(url)}.json`, TTL 30 min for forecasts, **infinite for
historical** (immutable). This cache is what makes the app feel instant and keeps us inside Open-Meteo's free
rate limits during a live demo with judges clicking around.

---

## 12. Repository layout

```
RENEWCAST/
├── README.md                          # front door: what it is, how to run
├── README_PROJECT.md                  # ← this document
├── README_UI.md                       # UI/UX specification
│
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── app/
│   │   ├── main.py                    # FastAPI app, CORS, router mount, startup model load
│   │   ├── config.py                  # pydantic-settings
│   │   ├── schemas.py                 # all pydantic request/response models
│   │   ├── store.py                   # SQLite + file cache
│   │   ├── data/
│   │   │   ├── sites.py               # 5 Indian plants + asset/tariff defaults
│   │   │   └── constants.py           # emission factors, tariffs, turbine classes
│   │   ├── core/
│   │   │   ├── weather.py             # Open-Meteo forecast / hist-forecast / archive clients
│   │   │   ├── astronomy.py           # solar position, clear-sky GHI (no deps)
│   │   │   ├── physics.py             # Stage A: PV model + turbine power curve
│   │   │   ├── features.py            # leak-free feature matrix builder (shared train↔serve)
│   │   │   ├── model.py               # Stage B: load/predict quantiles, monotonic repair
│   │   │   ├── baselines.py           # climatology / persistence / physics-only
│   │   │   ├── decision.py            # detect → attribute → rank → dispatch → quantify
│   │   │   ├── simulator.py           # what-if scenarios + break-even search
│   │   │   ├── explain.py             # deterministic explainer + Gemini adapter
│   │   │   └── ingest/
│   │   │       ├── opsd.py            # Open Power System Data adapter
│   │   │       ├── perform.py         # ARPA-E PERFORM adapter
│   │   │       └── csv_upload.py      # user's own actuals
│   │   └── routers/                   # sites · forecast · risk · actions · simulate
│   │                                  # copilot · backtest · fleet · history · ingest
│   ├── scripts/
│   │   ├── build_dataset.py           # OPSD + archived forecasts → parquet
│   │   ├── train.py                   # fit quantile models + metrics.json + model_card.json
│   │   └── smoke_test.py              # hit every endpoint, assert shapes  ← run before demo
│   ├── models/                        # committed .joblib + metrics.json + model_card.json
│   ├── data/{raw,processed,cache}/    # gitignored
│   └── tests/                         # physics sanity, no-leak assertion, dispatch energy balance
│
└── frontend/                          # Next.js 15 — full spec in README_UI.md
    ├── src/app/                       # / · /sites/[siteId] · /sites/[siteId]/decisions · /accuracy
    ├── src/components/                # charts, panels, cards, copilot
    ├── src/lib/api.ts                 # typed client, one fn per endpoint
    └── .env.local
```

### Critical-path test suite (small but high value)

| Test | Asserts |
|------|---------|
| `test_physics.py` | zero solar at night · zero wind below cut-in **and above cut-out** · cf ∈ [0,1] |
| `test_no_leak.py` | **no feature name matches `y_lag|target|actual|gen_roll`** — machine-enforced integrity |
| `test_dispatch.py` | energy balance: served + curtailed + unserved = available, ±1e-6 |
| `test_quantiles.py` | P10 ≤ P50 ≤ P90 for every hour after monotonic repair |

`test_no_leak.py` is worth mentioning to judges — it turns "we avoided leakage" from a claim into a test.

---

## 13. Configuration & environment variables

**`backend/.env`** (copy from `.env.example`)
```ini
GEMINI_API_KEY=                      # optional — blank ⇒ deterministic explainer
GEMINI_MODEL=gemini-3.5-flash-lite
ALLOWED_ORIGINS=http://localhost:3000,https://renewcast.vercel.app
WEATHER_CACHE_TTL_MIN=30
DEFAULT_HORIZON_HOURS=72
MODEL_DIR=models
DB_PATH=data/renewcast.db
```

**`frontend/.env.local`**
```ini
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

---

## 14. 🔴 WHAT YOU MUST DO MANUALLY

Everything else I do. These need a human.

### Before I write code

- [x] **A1. Repo location — DONE.** Moved to `E:\RENEWCAST`, off OneDrive. This removes risk #1 from §18
      (OneDrive syncing `node_modules` / `.venv`, which locks files mid-build).
- [ ] **A2. Accept the phase plan in §15** — specifically **Rule 2: we deploy at Phase 5, not at the end.**
      That means you will need the Render + Vercel accounts (B3/B4) roughly halfway through the build, not at
      the finish. If you'd rather deploy only once at the end, tell me now and I'll re-order — but I don't
      recommend it.

### Accounts & keys — do these while I build the backend

- [ ] **B1. Gemini API key** → https://aistudio.google.com/apikey → paste into `backend/.env` as
      `GEMINI_API_KEY=…`. **Free tier is enough.** Not blocking: the Copilot works without it.
- [ ] **B2. GitHub repo.** Create an empty repo `renewcast`. I will init, commit and prepare the push; you run
      the `git push` (your credentials, not mine).
- [ ] **B3. Vercel account** (sign in with GitHub) — for the frontend.
- [ ] **B4. Render account** (sign in with GitHub) — for the backend.

### Deployment clicks — hour ~19, I will hand you exact values

- [ ] **C1. Vercel → New Project → import `renewcast`** → Root Directory **`frontend`** → add env var
      `NEXT_PUBLIC_API_BASE` = your Render URL → Deploy.
- [ ] **C2. Render → New Web Service → import `renewcast`** → Root Directory **`backend`** →
      Build `pip install -r requirements.txt` → Start
      `uvicorn app.main:app --host 0.0.0.0 --port $PORT` → add `GEMINI_API_KEY` + `ALLOWED_ORIGINS`.
- [ ] **C3.** Paste the Render URL back into Vercel's env var and redeploy. (Chicken-and-egg: backend first.)

### Judgement calls only you can make

- [ ] **D1. Emission factors & tariffs.** I ship the indicative defaults in §7.3. If your team has better
      India-specific numbers (CEA CO₂ baseline database, actual PPA rates), give them to me and I will use
      yours — sourced numbers beat my defaults in Q&A.
- [ ] **D2. Demand/commitment profile per site.** Real plant schedules aren't public. Default: a synthetic
      Indian load shape (morning shoulder, deep evening peak 18:00–23:00) scaled to each plant's capacity,
      **clearly labelled as a reference profile**. Tell me if you'd rather use a flat PPA commitment instead.
- [ ] **D3. Branding.** Confirm the name **RenewCast** and give me a colour preference, or let me pick
      (my default: deep slate command-center dark theme with amber/cyan risk accents — see `README_UI.md`).

### Before you present

- [ ] **E1. Run `python backend/scripts/smoke_test.py`** — hits every endpoint and asserts shapes. Green = safe
      to demo.
- [ ] **E2. Warm the deployed backend** by loading the site 2 minutes before you present (Render free tier
      sleeps after ~15 min idle; first request costs ~50 s).
- [ ] **E3. Screen-record a 3-minute backup demo video.** If conference wifi dies, you still present. Do not
      skip this.
- [ ] **E4. Read the Model Card page once**, so whoever handles Q&A can state the limitations confidently
      instead of being surprised by them.

---

## 15. Phased build plan

No clock times. **Phases, each with a binary exit gate.** A phase is done when its gate passes — not when
it "mostly works". We never start phase *N+1* while phase *N*'s gate is red.

Total budget: **24 hours maximum.**

### 15.0 The two rules that govern everything

> **Rule 1 — Always demoable.** From the end of Phase 1 onward, the app must be able to go on stage at any
> moment. Every phase after that adds capability without ever leaving the product broken. There is no "it'll
> all come together at the end."
>
> **Rule 2 — Deploy at Phase 5, not at the end.** Deployment is a *mid-build* phase, and every later phase
> ends with a redeploy. The classic hackathon death is a perfect localhost app and a broken deploy at hour 23.

### 15.1 Dependency graph

```
 P0 Foundation
     │
     ▼
 P1 Physics spine ─────────────────────► ★ FIRST DEMOABLE STATE
     │                                     (real live 72h forecast, zero ML)
     ├──────────────┐
     ▼              ▼
 P2 ML model     P3 Decision engine        ← P3 does NOT wait for P2
     │              │                        (it consumes P1's output shape)
     └──────┬───────┘
            ▼
 P4 Command Center UI ───────────────────► ★ MINIMUM WINNING SUBMISSION
            │
            ▼
 P5 DEPLOY  ─────────────────────────────► ★ PUBLIC URL EXISTS  ← hard gate
            │
     ┌──────┼──────┬──────────┐
     ▼      ▼      ▼          ▼
 P6 What-if  P7 Copilot  P8 Credibility   ← independent, parallelisable
     └──────┴──────┴──────────┘
            ▼
 P9 Extended reach (all optional)
            ▼
 P10 Freeze & pitch                      ← never cut, always fits
```

### 15.2 The phases

#### Phase 0 — Foundation
**Goal:** prove the whole wire end-to-end before any real logic exists.

| Exit gate |
|---|
| ☐ venv created, all deps import cleanly on Python 3.14 (LightGBM confirmed or fallback selected) |
| ☐ `uvicorn` boots; `GET /api/health` returns `{status, model_version, gemini_configured}` |
| ☐ Next.js boots; a page fetches `/api/health` and renders the result — **CORS proven working now, not later** |
| ☐ `git init`, first commit |

*Cut rule:* nothing. This phase is non-negotiable and small.

---

#### Phase 1 — Physics spine ★
**Goal:** a real 72-hour forecast for a real Indian plant from live weather, with **zero** machine learning.

| Exit gate |
|---|
| ☐ `weather.py` fetches live Open-Meteo for any lat/lon, file-cached |
| ☐ `astronomy.py` computes solar position + clear-sky GHI with no external dependency |
| ☐ `physics.py` produces PV output (POA → cell temp → derate → clipping) and wind output (shear → density → power curve) |
| ☐ `GET /api/forecast/bhadla-solar?horizon=72` returns **72 hourly MW values from live ECMWF data** |
| ☐ `test_physics.py` green: night solar **exactly 0** · wind 0 below cut-in **and above cut-out** · cf ∈ [0,1] |

**Why this is the most important gate in the build:** after it, the product *works*. Everything downstream is
an upgrade to something already functioning, so there is no scenario where we have nothing to show.

*Cut rule:* nothing.

---

#### Phase 2 — ML quantile model
**Goal:** earn the word "AI-powered" with honest, measured numbers.

| Exit gate |
|---|
| ☐ `build_dataset.py` writes `train_solar.parquet` + `train_wind.parquet` (OPSD measured MW ⟷ archived forecast weather) |
| ☐ `features.py` shared by train and serve — **one code path, so train/serve skew is impossible** |
| ☐ 3 quantile models per technology trained and saved |
| ☐ `metrics.json` exists with MAE · RMSE · nMAE · skill vs all 3 baselines · PI coverage · per-lead-bucket error |
| ☐ `test_no_leak.py` green (no feature name matches `y_lag|target|actual|gen_roll`) |
| ☐ `test_quantiles.py` green (P10 ≤ P50 ≤ P90 every hour) |
| ☐ Forecast endpoint serves ML quantiles, **auto-falling back to physics if a model file is missing** |

*Cut rule:* if the data build fails → ship physics-only + physics-derived uncertainty bands, and say so
openly in the Model Card. The app does not regress; only the accuracy claim shrinks.

---

#### Phase 3 — Decision engine
**Goal:** the actual differentiator — the half of the problem other teams skip.
**Runs in parallel with Phase 2** (it consumes P1's output contract, not P2's).

| Exit gate |
|---|
| ☐ `detect_events()` finds deficit (vs **P10**) and surplus (vs **P90**) runs with severity 0–100 |
| ☐ Every event carries a **human-readable driver** ("v₁₀₀ 2.1 m/s below cut-in 3.0") |
| ☐ `rank_actions()` merit-orders battery / demand-shift / curtail / backup / market |
| ☐ `simulate_dispatch()` walks battery SoC hour by hour and reports **residual unserved energy** |
| ☐ Quantified MWh · ₹ · tCO₂ per action, plus the "value of deciding now vs late" delta |
| ☐ `GET /api/risk/{id}` and `GET /api/actions/{id}` live |
| ☐ `test_dispatch.py` green: served + curtailed + unserved = available (±1e-6) |

*Cut rule:* drop `MARKET_SELL/BUY` and `RESCHEDULE_MAINTENANCE` first. The three actions the problem
statement explicitly names — **curtailment, storage dispatch, backup activation** — are never cut.

---

#### Phase 4 — Command Center UI ★
**Goal:** the screen that goes on stage.

| Exit gate |
|---|
| ☐ Site selector · horizon toggle 24/48/72 · KPI row |
| ☐ Forecast chart with the **P10–P90 band**, P50 line, capacity reference, demand overlay |
| ☐ Risk ribbon under the chart, time-aligned with it |
| ☐ Alert list → click an alert, chart scrolls/zooms to that window |
| ☐ Ranked action cards with MWh · ₹ · tCO₂ |
| ☐ Loading, empty and **error** states on every panel (a red API error on stage looks like a crash) |
| ☐ Runs against the live backend, not mocks |

*Cut rule:* demand overlay, then the click-to-zoom interaction. The band and the ribbon stay.

---

#### Phase 5 — DEPLOY ★ (hard gate)
**Goal:** a public URL a judge can open on their own phone.

| Exit gate |
|---|
| ☐ Backend live on Render (models committed, so boot is a file load) |
| ☐ Frontend live on Vercel, pointed at the backend URL |
| ☐ Production CORS working |
| ☐ `smoke_test.py` green **against the production URL**, not localhost |
| ☐ URL opened successfully on a phone on mobile data (not just your wifi) |

> **This gate cannot be deferred.** If we reach it with phases 6–9 unbuilt, that is fine — we deploy, then
> keep building and redeploying. Every later phase ends with "redeploy + re-smoke-test".

---

#### Phase 6 — What-if simulator
| Exit gate |
|---|
| ☐ `POST /api/simulate` re-runs **the same** `simulate_dispatch()` under a modified config |
| ☐ UI sliders: battery MW / MWh / SoC / η · flexible demand · backup MW + notice · grid limit · tariffs · carbon price |
| ☐ Baseline-vs-scenario deltas: unserved · curtailed · ₹ · tCO₂ |
| ☐ Waterfall attributing the saving per lever |
| ☐ Break-even search: "smallest battery that removes this deficit entirely" |
| ☐ Redeployed |

*Cut rule:* break-even search first, then the waterfall (fall back to a delta table).

---

#### Phase 7 — Copilot
| Exit gate |
|---|
| ☐ Deterministic explainer answers all 5 intents (WHY · WHAT_ACTION · CONFIDENCE · COMPARE · SUMMARY) with **no key** |
| ☐ Gemini adapter behind `GEMINI_API_KEY`, strictly grounded, hard-instructed never to invent a number |
| ☐ UI badges the mode honestly (`AI · Gemini` vs `Rule-based explainer`) |
| ☐ Suggested-prompt chips |
| ☐ Redeployed |

*Cut rule:* free-form Q&A → fixed prompt chips only. The **deterministic path is never cut** — it is what
guarantees the demo cannot break on a dead key or dead wifi.

---

#### Phase 8 — Credibility surfaces
**Goal:** the pages that survive Q&A. Cheap to build, disproportionately valuable.

| Exit gate |
|---|
| ☐ Accuracy page: real metrics, the 3 baselines, per-lead-bucket error curve, PI coverage |
| ☐ Model Card page: features, training data, and **explicitly stated limitations** (§5.1) |
| ☐ Redeployed |

*Cut rule:* merge both into one page rather than dropping either. Stating your own limitation before a judge
finds it is worth more than any extra feature.

---

#### Phase 9 — Extended reach (all optional)
Take these **only if phases 0–8 are green**, in this order:

1. **Fleet view** — portfolio aggregate across all 5 sites (best value: speaks directly to the "utility company" user)
2. **Forecast-vs-actual history** — reads the logged runs from SQLite; proves the system learns over time
3. **ARPA-E PERFORM adapter** — second ingest source, substantiates the "location-agnostic" claim
4. **CSV upload** — an operator uploads their own actuals; makes it a real product
5. **Map view** — pin-drop forecasting for any lat/lon

*Cut rule:* all five are cuttable. None of them is on the critical path.

---

#### Phase 10 — Freeze & pitch
**Goal:** convert a working app into a won hackathon. **Never cut — reserve room for it.**

| Exit gate |
|---|
| ☐ Code freeze. No new features, bug fixes only |
| ☐ `smoke_test.py` green against production |
| ☐ **Backup demo video recorded** (3 min, screen capture) — insurance against dead wifi |
| ☐ Pitch deck built from §19 (traceability) + §20 (script) |
| ☐ Demo rehearsed **end-to-end 3 times**, out loud, on the real URL |
| ☐ All three of you can answer: *why no lag features?* · *what are your baselines?* · *what are your limitations?* |
| ☐ Backend warmed right before presenting |

### 15.3 The MVP line

If everything goes wrong, **phases 0 → 1 → 3 → 4 → 5 → 10** still produce a complete, deployed, defensible
submission: real live forecasting, over/under-generation detection, ranked grid actions with quantified
impact, and a public URL. That path covers **every explicit requirement** of the problem statement.

Phases 2, 6, 7, 8, 9 are what turn a complete submission into a winning one.

### 15.4 Progress ledger

Updated as we go, so the state of the build is never a matter of opinion.

| Phase | Status |
|-------|--------|
| P0 Foundation | ☐ not started |
| P1 Physics spine | ☐ not started |
| P2 ML model | ☐ not started |
| P3 Decision engine | ☐ not started |
| P4 Command Center UI | ☐ not started |
| P5 Deploy | ☐ not started |
| P6 What-if simulator | ☐ not started |
| P7 Copilot | ☐ not started |
| P8 Credibility surfaces | ☐ not started |
| P9 Extended reach | ☐ not started |
| P10 Freeze & pitch | ☐ not started |

---

## 16. Team split (3 people)

The architecture is deliberately layered so three people never edit the same file.

| Person | Owns | Files | Presents |
|--------|------|-------|----------|
| **Nishtha** | Integration + AI layer + narrative | `explain.py`, `routers/copilot.py`, Copilot UI, Model Card page, README/deck | Opening problem framing + Copilot |
| **Kunj** | Frontend & visual system | `src/app/*`, `src/components/*`, chart components, theming, responsive polish | Live dashboard walkthrough |
| **Laksh** | Simulator + quantification + data prep | `simulator.py`, What-If page, tariff/emission config, `build_dataset.py` runs, deck numbers | What-if scenario + ₹/tCO₂ impact |

Everyone should be able to answer: **"why no lag features?"**, **"what are your baselines?"**, and
**"what are your model's limitations?"** Those are the three questions that decide the score.

---

## 17. Deployment

```
GitHub  ──┬──► Vercel   (frontend/)  →  https://renewcast.vercel.app
          └──► Render   (backend/)   →  https://renewcast-api.onrender.com
```

**Backend (Render, free Web Service)** — root `backend`, Python 3.11+ runtime,
build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
Models are committed, so boot is a file load, not a training run.

**Known free-tier issue:** Render sleeps after ~15 min idle → ~50 s cold start. Mitigations, in order:
1. **Warm it manually 2 minutes before presenting** (simplest, always works — checklist item E2).
2. An external uptime pinger hitting `/api/health` every 10 min.
3. If it becomes a real problem, redeploy the backend to **Hugging Face Spaces** (also free, much less
   aggressive sleep). The app is a plain FastAPI service, so this is a 15-minute move.

**Local dev**
```bash
# terminal 1 — backend
cd backend && .venv/Scripts/activate && uvicorn app.main:app --reload --port 8000

# terminal 2 — frontend
cd frontend && npm run dev
```

---

## 18. Risk register & fallbacks

| # | Risk | Likelihood | Mitigation / fallback |
|---|------|-----------|------------------------|
| 1 | ~~**OneDrive** locks or slow-syncs `node_modules` / `.venv`~~ | **RESOLVED** | Repo moved to `E:\RENEWCAST`, outside OneDrive |
| 2 | LightGBM has no Python 3.14 Windows wheel | Medium | `HistGradientBoostingRegressor` fallback is already in the design — same algorithm family, zero code change beyond the estimator factory |
| 3 | OPSD download too slow on hackathon wifi | Medium | Fall back to per-TSO-zone column subset; then to Elia (tiny payloads); then to ERA5-driven physics targets. Ship a small pre-built parquet in git as a last resort |
| 4 | Open-Meteo rate limit during live judging | Low-Med | 30-min file cache + pre-warmed cache for all 5 sites committed before the demo. Judges clicking around hits cache, not the API |
| 5 | Render cold start mid-demo | **High if unmanaged** | Checklist E2 + pinger + HF Spaces escape hatch |
| 6 | Gemini quota / key issues | Medium | Deterministic explainer is the default path; Gemini is strictly an upgrade. Demo cannot break |
| 7 | ARPA-E PERFORM S3 paths shift | Medium | Adapter is **optional and isolated**; its failure degrades one tab, never the core app. Guarded by `/api/ingest/perform/status` |
| 8 | Model underperforms baselines | Low-Med | We publish the real numbers and pivot the narrative to the decision layer — which is the actual differentiator anyway. **Never fake a metric** |
| 9 | Running out of time on the frontend | Medium | Page priority is fixed: Command Center → Risk/Actions → Simulator → Accuracy → Fleet. Cut from the right |
| 10 | Everyone edits the same file at T+20 | Medium | Ownership table in §16; frontend and backend are separate directories |

---

## 19. Judging-criteria traceability

| Problem-statement requirement | Where we satisfy it |
|-------------------------------|---------------------|
| "ingests weather data, historical generation records, and site-level parameters" | §5 — 3 live weather APIs + OPSD measured generation + ARPA-E PERFORM + full site registry with geometry/assets |
| "forecast solar/wind output over the next 24–72 hours" | §6 — leak-free weather-driven quantile model, horizon selector 24/48/72 |
| "flag periods of expected over/under-generation" | §7.1 — deficit vs **P10**, surplus vs **P90**, severity scoring, driver attribution |
| "recommend grid actions (curtailment, storage dispatch, backup activation)" | §7.2 — all three named actions plus demand shift, market, maintenance; merit-ordered with a dispatch schedule |
| Impact: "reduces energy wastage / fossil-fuel backup reliance" | §7.3 — curtailed MWh avoided and backup tCO₂ avoided, quantified per action |
| Impact: "improves grid stability by anticipating fluctuations" | §7.1 ramp-rate detection + §7.2 `notice_hours` and the "value of deciding now" delta |
| Impact: "better financial planning for producers and traders" | §7.3 ₹ impact, §8 break-even sizing, trader-oriented Copilot summary |
| Users: operators · utilities · plant owners · traders | `README_UI.md` — Command Center (operator), Fleet (utility), Site detail (owner), Copilot trader summary |

---

## 20. Demo script (3 minutes)

| Time | Beat | Words / action |
|------|------|----------------|
| 0:00 | Problem, concretely | "Solar collapses at 18:30. Demand peaks at 19:00. If the operator learns that at 18:00, the only option left is diesel." |
| 0:20 | Live forecast | Open Bhadla, 72h. "This is real ECMWF weather pulled minutes ago — not a CSV replay. The shaded band is P10–P90, and notice it *widens* with horizon. That's honest uncertainty." |
| 0:50 | Detect | Point at the red ribbon. "Two events. The critical one is 19:00–21:00 tomorrow: 340 MW deficit, severity 78, driver — post-sunset ramp into evening peak." |
| 1:15 | Decide & Quantify | "It doesn't stop at the warning. Merit order: hold battery charge now, discharge 180 MW across the window, shift 40 MW of flexible load. Diesel stays last. Net: 210 MWh of fossil backup avoided, ₹4.6 lakh saved, 157 tCO₂ avoided." |
| 1:45 | What-if | Drag the battery slider. "Break-even: 180 MW / 420 MWh removes this deficit entirely. That's a procurement decision, from a forecast." |
| 2:10 | Credibility | Accuracy page. "nMAE X% of capacity, Y% skill over persistence, P10–P90 covers Z% of actuals. And we use **no lag features** — so this number holds at hour 72, not just hour 1. There's a unit test that enforces it." |
| 2:35 | Copilot | Ask *"Why is tomorrow evening risky?"* "Grounded strictly on the computed forecast. The LLM explains; it never invents a megawatt." |
| 2:50 | Close | "Forecasting is half the problem. RenewCast does the other half: detect, decide, quantify, explain." |

---

*RenewCast · HackOut'26 · Team TriHack — Kunj Vaghani · Laksh Tank · Nishtha Shah · L.D. College of Engineering*
