# RenewCast — Complete Explanation

> **What this document is:** A plain-language walkthrough of *everything* inside
> RenewCast — what the app does, how every page works, every term used, every
> formula, every algorithm, and why each design choice was made over the
> alternatives.
>
> No jargon is introduced without an immediate definition. If you understand
> this document you understand the product.

---

## Table of Contents

1. [What Is RenewCast?](#1-what-is-renewcast)
2. [The Problem It Solves](#2-the-problem-it-solves)
3. [The Five Real Sites](#3-the-five-real-sites)
4. [The Indian Despatch Day — 96 Time Blocks](#4-the-indian-despatch-day--96-time-blocks)
5. [Architecture Overview](#5-architecture-overview)
6. [Stage A — Physics (Deterministic Models)](#6-stage-a--physics-deterministic-models)
7. [Stage B — Machine Learning (LightGBM Quantile Regression)](#7-stage-b--machine-learning-lightgbm-quantile-regression)
8. [P10 / P50 / P90 — Probabilistic Forecasting](#8-p10--p50--p90--probabilistic-forecasting)
9. [Feature Engineering — What the ML Model Sees](#9-feature-engineering--what-the-ml-model-sees)
10. [Weather Data — Open-Meteo](#10-weather-data--open-meteo)
11. [The Decision Engine](#11-the-decision-engine)
12. [The What-If Simulator](#12-the-what-if-simulator)
13. [The Copilot — AI-Powered Narration](#13-the-copilot--ai-powered-narration)
14. [Historical Data Ingestion](#14-historical-data-ingestion)
15. [Accuracy & Model Validation](#15-accuracy--model-validation)
16. [Every Page in the App](#16-every-page-in-the-app)
17. [Every Key Formula](#17-every-key-formula)
18. [Glossary of Every Term](#18-glossary-of-every-term)
19. [Why These Technology Choices](#19-why-these-technology-choices)

---

## 1. What Is RenewCast?

RenewCast is a **renewable energy forecasting and despatch decision platform** for Indian solar and wind power plants.

In simple terms: it predicts how much electricity a solar park or wind farm will generate over the next 72 hours, and then tells the plant operator what to *do* about it — store energy, curtail generation, fire up a backup generator, or revise the schedule they filed with the grid.

It does this for **five real Indian renewable installations**, using live weather forecasts, real physics models, and machine learning.

---

## 2. The Problem It Solves

India's electricity grid runs on a **schedule**. Every power plant files a "declaration of capability" — a promise of how much power it will produce in each 15-minute block of the day. If the actual generation is significantly different from the promise, the plant faces financial penalties.

The catch: **you cannot control the sun or wind.** A cloud covers Bhadla Solar Park and suddenly you're 200 MW below your promise. The wind dies at Muppandal and your turbines stop. These are not equipment failures — they're weather.

RenewCast solves this by:
1. **Forecasting** the generation 72 hours ahead, with uncertainty bands
2. **Comparing** the forecast against the declared schedule
3. **Recommending** specific actions to close any gap
4. **Pricing** each action in ₹ and CO₂ so the operator can choose

---

## 3. The Five Real Sites

| Site | State | Type | Capacity | Key Feature |
|------|-------|------|----------|-------------|
| **Bhadla Solar Park** | Rajasthan | Solar (fixed tilt) | 2,245 MW | World's largest solar park. Thar desert dust causes heavy soiling. |
| **Pavagada Solar Park** | Karnataka | Solar (single-axis tracking) | 2,050 MW | Trackers follow the sun east to west, broadening the daily output curve. |
| **Charanka Solar Park** | Gujarat | Solar (fixed tilt) | 790 MW | India's first large park (2012). Older modules, more degradation. |
| **Muppandal Wind Farm** | Tamil Nadu | Wind | 1,500 MW | Aralvaimozhi gap winds — so strong during monsoon that Tamil Nadu curtails. |
| **Jaisalmer Wind Park** | Rajasthan | Wind | 1,064 MW | Thar desert wind, higher hub height (100 m), IEC Class II turbines. |

All coordinates and capacities are real. Everything else — evacuation limits, tariffs, battery sizes — is an engineering assumption marked as "indicative" throughout the product.

---

## 4. The Indian Despatch Day — 96 Time Blocks

The Indian electricity grid divides each day into **96 time blocks** of **15 minutes** each.

- Block 1 = 00:00–00:15 IST
- Block 2 = 00:15–00:30 IST
- ...
- Block 43 = 10:30–10:45 IST
- ...
- Block 96 = 23:45–24:00 IST

**Why this matters:** Every schedule filed with the grid, every deviation penalty, and every forecast in RenewCast is expressed per-block. This is not a design choice — it's a regulatory fact. The Central Electricity Regulatory Commission (CERC) mandates this structure.

### The Revision Horizon

Once a schedule is filed, you can still revise it — but only with lead time:

- **Voluntary revision**: takes effect from the **6th block ahead** (90 minutes)
- **RLDC-initiated revision**: takes effect from the **4th block ahead** (60 minutes)

Blocks before this horizon are **locked** — no forecast, however accurate, can change them. This is why the UI dims past blocks and why forecast value decays with delay.

---

## 5. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                     FRONTEND                         │
│    Next.js 16 + React 19 + Tailwind CSS 4            │
│    Runs at http://localhost:3000                      │
├──────────────────────────────────────────────────────┤
│                     BACKEND                          │
│    FastAPI (Python) + LightGBM + NumPy               │
│    Runs at http://localhost:8000                      │
│    All routes under /api/                            │
├──────────────────────────────────────────────────────┤
│                 EXTERNAL SERVICES                    │
│    Open-Meteo (free weather API, no key needed)      │
│    Gemini API (optional, for copilot narration)      │
└──────────────────────────────────────────────────────┘
```

### The Two-Stage Forecast Pipeline

```
Live Weather (hourly, from Open-Meteo)
  → Interpolated to 15-minute blocks
    → Feature engineering (physics + calendar + weather)
      → Stage A: Deterministic physics model (sun/wind → MW)
        → Stage B: LightGBM corrects physics with learned residuals
          → P10 / P50 / P90 forecast in MW per block
```

**Stage A (Physics)** is pure physics — no training data needed. Given sun position and weather, it calculates exactly how much power the machinery produces.

**Stage B (Machine Learning)** learns the *gap* between physics and reality, then applies that correction as a probability band (P10/P50/P90).

---

## 6. Stage A — Physics (Deterministic Models)

### Solar Model

The solar power calculation follows this chain:

**1. Sun Position (NOAA Solar Equations)**

Where is the sun right now? This is pure geometry:

```
zenith = angle from directly overhead
elevation = 90° − zenith
azimuth = compass direction of the sun
```

The equations account for:
- Earth's tilted axis (**declination** — ±23.44° over a year)
- Earth's elliptical orbit (**equation of time** — the sun runs up to 16 minutes fast or slow against the clock)
- India running one timezone across 28° of longitude (Jaisalmer's solar noon is nearly 40 minutes after Kolkata's)

**2. Plane-of-Array Irradiance (Liu & Jordan Model)**

How much sunlight actually hits the solar panels? Three components:

```
POA = Beam + Sky Diffuse + Ground Reflected

Beam = DNI × cos(angle of incidence)     — direct sunlight projected onto the panel
Sky  = DHI × (1 + cos(tilt)) / 2          — scattered skylight from the dome above
Ground = GHI × albedo × (1 − cos(tilt))/2 — light bouncing off the ground
```

- **GHI** = Global Horizontal Irradiance (total sunlight on a flat surface)
- **DNI** = Direct Normal Irradiance (the direct beam from the sun)
- **DHI** = Diffuse Horizontal Irradiance (scattered light from the sky)
- **Albedo** = ground reflectance (0.20 for vegetation/soil)

For **tracking panels** (like Pavagada), the tilt and azimuth change throughout the day as the panel follows the sun east to west. This is why Pavagada's curve is a broad plateau while fixed-tilt Bhadla's is a narrower peak.

**3. Cell Temperature (NOCT Method)**

Solar cells get HOT — 25–35°C above ambient under full sun. At Bhadla in May, that means 45°C air → 75°C cell, costing about 19% of output.

```
Temperature Rise = (NOCT − 20°C) / 800 × POA

Cell Temperature = Ambient + Temperature Rise × Wind Cooling Factor
```

- **NOCT** = Nominal Operating Cell Temperature = 45°C
- Wind cools the panels (the cooling factor is proportional to 1/√wind_speed)

**4. DC → AC Conversion**

```
DC Power = Capacity × (POA / 1000) × (1 + temperature_coefficient × (T_cell − 25°C))
AC Power = min(DC × inverter_efficiency, nameplate_capacity)    ← inverter clipping
AC Power = AC × (1 − system_losses)                              ← soiling, wiring, etc.
```

- **Temperature coefficient**: −0.38%/°C (crystalline silicon loses power as it gets hotter)
- **DC/AC ratio**: typically 1.25–1.30 (the DC array is deliberately oversized, so the inverter "clips" — the flat-topped midday plateau on a clear day)
- **System losses**: 13–17% (soiling, wiring, mismatch, degradation)

### Wind Model

**1. Hub-Height Wind Speed (Power Law)**

Weather forecasts report wind at 10m above ground. Turbines sit at 80–120m where the wind is faster.

```
V_hub = V_10m × (hub_height / 10)^α
```

- **α (shear exponent)**: measures how much wind speed changes with height. Typically 0.11–0.14 for open terrain, but varies with atmospheric stability.

**Better approach**: Open-Meteo provides wind at both 10m and 100m. RenewCast calculates the *actual* shear exponent from both measurements:

```
α = ln(V_100 / V_10) / ln(100 / 10)
```

Then extrapolates from the *closer* height (100m rather than 10m), because interpolating a short distance is more accurate than extrapolating an order of magnitude.

**Why this matters**: At Muppandal, the measured median shear is 0.21 vs. the assumed 0.11. Because power goes as v³, this difference alone is worth roughly 35% of output.

**2. Air Density Correction**

```
ρ = P / (R × T)    where R = 287.05 J/(kg·K)
```

Turbines are rated at sea-level density (1.225 kg/m³). Hot, high-altitude air is thinner — Jaisalmer at 225m in 45°C has ~1.10 kg/m³, a 10% power deficit.

The correction is applied to *speed* (as the cube root of density ratio) rather than to power, so that cut-in and cut-out thresholds stay in the right place.

**3. Power Curve (Normalised Table, Not v³)**

The textbook formula `P ∝ v³` is badly wrong in practice. At 7 m/s with a 13 m/s rated speed it gives 5% of rated power; the real machine delivers 29%.

RenewCast uses a **normalised lookup table** digitised from a real Vestas V90-2.0 MW turbine:

```
v/v_rated:  0.00  0.27  0.31  0.38  0.46  0.54  0.62  0.69  0.77  0.85  0.92  1.00
P/P_rated:  0.00  0.00  0.04  0.10  0.18  0.29  0.44  0.60  0.77  0.90  0.96  1.00
```

The real curve is an S-shape: steeper than cubic below the knee, flatter above. By normalising against rated speed, one table works for all three IEC classes.

**Cut-out** (25 m/s) is kept as a sharp cliff — the turbine goes from full output to zero. This is real and critical: a storm forecast is a *generation risk*, not a bonus.

**4. Final Farm Output**

```
Farm MW = Capacity × Power_fraction × (1 − wake_loss) × availability
```

- **Wake loss** (8–12%): turbines downwind see slower, more turbulent air
- **Availability** (95–97%): scheduled and unscheduled downtime

---

## 7. Stage B — Machine Learning (LightGBM Quantile Regression)

### What It Is

**LightGBM** is a gradient boosting decision tree algorithm. Think of it as hundreds of simple "if-then" rules stacked together, where each new rule corrects the mistakes of the previous ones.

### Why LightGBM Instead of Neural Networks?

| Factor | LightGBM | Neural Network |
|--------|----------|----------------|
| Training speed | Minutes | Hours/days |
| Interpretability | Can inspect feature importance | Black box |
| Data requirement | Works well with ~500K rows | Needs millions |
| Handling missing data | Built-in | Requires preprocessing |
| Tabular data | State of the art | Generally worse |

For tabular weather data with ~500K–700K rows, LightGBM is the right tool.

### What It Learns

Stage B does NOT predict MW directly. It predicts the **residual** — the gap between physics and reality:

```
target = actual_capacity_factor − physics_capacity_factor
```

**Why a residual?**

1. **Scale-free**: Bhadla at 2,245 MW and Charanka at 790 MW become comparable, so one model can pool all solar sites and see 3× the data.
2. **Small target**: The residual is centred near zero with a narrow spread — far easier to fit than 0–2,245 MW.
3. **Interpretable**: "Physics said 1,800 MW, the model shaves 6%" is something an operator can verify.

### Quantile Regression

Instead of predicting a single number, the model predicts **three quantiles**:

- **P10 model**: trained to minimise the α=0.10 pinball loss
- **P50 model**: trained to minimise the α=0.50 pinball loss (= median)
- **P90 model**: trained to minimise the α=0.90 pinball loss

The **pinball loss** for quantile α is:

```
L(y, ŷ, α) = α × max(y − ŷ, 0) + (1 − α) × max(ŷ − y, 0)
```

In plain English:
- The P10 model is penalised **9× more for overestimating** than underestimating, so it learns to predict low (a "bad day" estimate)
- The P90 model is penalised **9× more for underestimating** than overestimating, so it learns to predict high (a "good day" estimate)
- P50 is penalised equally both ways → the median

This gives three separate models, each producing a different quantile of the output distribution. They are NOT three outputs from one model — they are independently trained.

### The Zero-Leak Guarantee

**The single most important design rule in the system:**

> No feature may be derived from the target.

No lag of generation, no rolling mean of output, no "yesterday's peak". Everything comes from weather, calendar, plant geometry, or the physics model — all available at forecast time.

A target lag (`y_lag_1`) correlates ~0.99 with `y` at 15-minute resolution, so the model scores beautifully and has learned *persistence* (just repeat what happened last) rather than *forecasting*. It then collapses when it has to predict block 90 at 06:00, because the lag doesn't exist yet.

The test suite (`test_no_leak.py`) enforces this by inspecting feature names automatically.

---

## 8. P10 / P50 / P90 — Probabilistic Forecasting

These are the core output of the system:

| Quantile | Meaning | Used For |
|----------|---------|----------|
| **P10** | There's a 10% chance output will be *below* this | Deficit risk — "how bad could it get?" |
| **P50** | The median — 50% chance above, 50% below | Energy accounting, revenue |
| **P90** | There's only a 10% chance output will be *above* this | Surplus/curtailment — "how good could it get?" |

The **P10–P90 band** covers 80% of outcomes. It is NOT a confidence interval of the estimate — it is a prediction interval of the *actual generation*.

### Why the Asymmetry Is the Design

Each decision in the system binds to a *different* quantile:

```
Deficit risk      = Schedule − P10    (the credible floor)
Surplus risk      = P90 − Schedule    (the credible ceiling)
Curtailment risk  = P90 − Evacuation  (what the wires can't take)
Energy revenue    = P50               (the central estimate)
```

**Covering a shortfall against P50 is the mistake this framing prevents.** The median is wrong half the time in the direction that hurts — an operator who arranges backup against P50 is under-covered every other day.

---

## 9. Feature Engineering — What the ML Model Sees

### Solar Features (22 columns)

| Feature | What It Is | Why It Matters |
|---------|-----------|----------------|
| `physics_cf` | Stage A output as capacity factor | The anchor — what physics thinks |
| `lead_hours` | Hours until this block | Uncertainty grows with lead time |
| `temp_c` | Temperature | Hot cells lose power |
| `humidity` | Relative humidity | Affects atmospheric absorption |
| `cloud_pct` | Cloud cover percentage | The dominant driver of solar variability |
| `precip_mm` | Precipitation | Rain cleans panels (good) but blocks sun (bad) |
| `pressure_pa` | Atmospheric pressure | Affects clear-sky transmission |
| `hour_sin`, `hour_cos` | Hour encoded as a circle | Hour 23 and 0 are adjacent, not 23 apart |
| `doy_sin`, `doy_cos` | Day of year encoded as a circle | Seasonal patterns wrap around |
| `ghi`, `dni`, `dhi` | Three irradiance components | Direct, diffuse, and total — different cloud impacts |
| `clear_sky_ghi` | What GHI *would be* with no clouds | The denominator of the clear-sky index |
| `clear_sky_index` | Actual GHI / Clear-sky GHI | Separates "low because 6am" from "low because cloudy" |
| `solar_elevation` | Sun angle above horizon | Determines path through atmosphere |
| `air_mass` | Optical path length | How much atmosphere the light traverses |
| `diffuse_fraction` | DHI / GHI | Separates haze (high diffuse) from broken cloud (variable) |
| `ghi_ramp_1h` | GHI change over 1 hour | Rising = clearing; falling = arriving cloud |
| `cloud_ramp_1h` | Cloud change over 1 hour | Rapid increase = approaching weather system |
| `clear_sky_index_std_1h` | Variability of CSI over 1 hour | Best proxy for broken cloud (intermittent shadows) |
| `wind_ms` | Wind speed | Cools solar panels |

### Wind Features (22 columns)

| Feature | What It Is | Why It Matters |
|---------|-----------|----------------|
| `wind_ms` | 10m wind speed | Raw measurement |
| `wind_100_ms` | 100m wind speed | Closer to hub height |
| `gust_ms` | Wind gust speed | Turbulence reduces efficiency |
| `wind_dir_sin`, `wind_dir_cos` | Wind direction as circle | Direction affects wake patterns |
| `shear_ratio` | V_100 / V_10 | Measures atmospheric stability, not just speed |
| `turbulence_intensity` | (gust − mean) / mean | Turbulent air costs output at the same mean speed |
| `air_density` | kg/m³ from temperature/pressure | Thin air = less power at same speed |
| `wind_ramp_1h` | Speed change over 1 hour | Approaching fronts |
| `wind_std_1h` | Speed variability over 1 hour | Measures gustiness |
| `wind_cubed` | v³ | Power is proportional to v³; giving the model the cube saves it learning this |

### Cyclical Encoding

Hours and days are **circular** — hour 23 and hour 0 are adjacent in time but 23 apart as numbers. Encoding them as sin/cos pairs places them on a circle where the distance is correct:

```
hour_sin = sin(2π × hour / 24)
hour_cos = cos(2π × hour / 24)
```

---

## 10. Weather Data — Open-Meteo

### Why Open-Meteo?

- **Free**, no API key needed, no account required
- Provides both **live forecasts** and **archived historical forecasts**
- Covers all Indian locations
- Returns GHI, DNI, DHI, wind at 10m and 100m, temperature, humidity, cloud cover, pressure, precipitation, gusts

### Why Archived *Forecasts* and Not Reanalysis?

This is critical and often done wrong.

**Reanalysis** (like ERA5) is the best retrospective estimate of what the weather *actually was*. It seems like the obvious training source — but it's the wrong choice.

At serving time the model sees a *forecast* — which is wrong, systematically, in ways that worsen with lead time. A model trained on perfect weather (reanalysis) has no idea that a 3-day-ahead GHI number tends to run optimistic. It scores beautifully in validation and fails in production.

Open-Meteo's archived-forecast API returns **what was actually predicted at the time**. The `_previous_dayN` variants give the forecast issued N days earlier. This is how the model learns that lead time degrades accuracy — from real measured forecast error, not assumed error.

### Hourly → Block Interpolation

Open-Meteo provides hourly data. RenewCast needs 15-minute blocks. The interpolation is **identical** in training and serving — the same code path runs in both cases, which is the only reliable defence against train/serve skew.

---

## 11. The Decision Engine

The decision engine turns a probability band (P10/P50/P90) into **priced, actionable instructions**.

### Step 1: Synthesise a Declared Schedule

Real declared-capability filings are not public per-block data. RenewCast creates a plausible schedule from the forecast's own P50:

```
Schedule = smoothed P50 × (0.96 + small sinusoidal drift)
```

- **Smoothing** (3-block rolling mean): a real declaration is filed as a smooth shape, not block-by-block
- **0.96 haircut**: generators declare slightly *below* what they expect, because under-delivering is penalised worse than over-delivering
- **Sinusoidal drift**: real declaration error is systematic within a day (wrong in the same direction for hours)

### Step 2: Calculate Deviations

```
Deficit  = max(Schedule − P10, 0)    ← how much we might fall short
Surplus  = max(P90 − Schedule, 0)    ← how much we might overproduce
Curtailment = max(P90 − Evacuation Limit, 0)  ← what the wires can't carry
```

### Step 3: Battery Simulation (Merit Order)

The battery is simulated block by block, greedily, forward in time:

**For surplus**: charge the battery (absorb the excess)
**For deficit**: discharge the battery (cover the shortfall)

Three limits bind in every block: the inverter power rating, the energy on offer, and the empty/full state of charge. Whichever is smallest wins.

Round-trip efficiency (88%) is charged **once, on the way in** — applying it at both ends is a common mistake that makes storage look 12% worse.

### Step 4: Thermal Backup Stack

What the battery cannot handle goes to the merit order:

| Action | Cost (₹/MWh) | CO₂ (t/MWh) | When |
|--------|--------------|-------------|------|
| **Battery discharge** | 4,500 | −0.71 (avoided) | First choice — cheapest |
| **Gas peaker** | 8,000 | 0.45 | When battery is empty |
| **Diesel** | 22,000 | 0.75 | Last resort — most expensive and dirtiest |
| **Battery charge** | 4,500 | −0.71 (avoided) | Absorb surplus |
| **Curtailment** | Revenue forgone | Grid replaces it | When nothing can absorb the excess |

### Step 5: Risk Events

Contiguous blocks with the same condition (deficit/surplus/curtailment) are grouped into **events**. Each event gets:

- **Severity score** (0–100) based on:
  ```
  severity = 100 × [0.45 × magnitude_ratio + 0.25 × duration_ratio
                    + 0.15 × time_of_day_factor + 0.15 × uncertainty_width]
  ```
- **Risk level**: Good (<25), Watch (25–49), Serious (50–74), Critical (75–100)
- **Physical driver** (e.g. "Dense cloud cover suppressing solar irradiance" or "Hub-height wind below cut-in threshold")
- **Recommended action** with cost

### Step 6: Headline

One sentence for the top of the page, generated server-side so the numbers and the headline come from the same arithmetic.

---

## 12. The What-If Simulator

The simulator lets an operator ask: **"What if I changed X?"**

It runs the exact same dispatch calculation as the decision engine, but with modified parameters:

- Change battery size (power MW, energy MWh)
- Change evacuation limit
- Change round-trip efficiency
- Add flexible demand
- Add backup capacity

It then compares **Baseline** (current configuration) vs. **Scenario** (modified configuration) and shows:

- Change in curtailed energy (MWh)
- Change in unserved energy (MWh)
- Change in total cost (₹)
- Change in CO₂ emissions (tonnes)
- Break-even analysis for the investment

---

## 13. The Copilot — AI-Powered Narration

The copilot turns a despatch plan into plain English. Two modes:

**Gemini mode**: A Gemini AI model writes prose, grounded in a compact fact block assembled by the backend. The LLM is **never given the raw payload and never asked to compute anything** — every number is pre-calculated and interpolated.

**Deterministic mode**: Templates over the same facts. Not degraded — it's what runs when no API key is set, and it's correct.

This division matters. Every number in the answer comes from the decision engine. The model's only job is to sequence and phrase them. An LLM that does arithmetic will eventually get it wrong in a way that reads perfectly fluently.

---

## 14. Historical Data Ingestion

The **Historical Data** page lets operators upload CSV files of actual generation data. The system:

1. **Auto-detects** timestamp and generation columns from header names
2. **Validates** each row (timestamps must parse, generation must be numeric and within nameplate capacity)
3. **Maps** timestamps to IST blocks
4. **Previews** the mapped data before committing
5. **Stores** actual generation in the database for future accuracy comparison

---

## 15. Accuracy & Model Validation

### Metrics Explained

| Metric | What It Means | Solar Value | Wind Value |
|--------|--------------|-------------|------------|
| **MAE** (Mean Absolute Error) | Average size of the error in MW | 44.44 MW | 91.27 MW |
| **NMAE** (Normalised MAE) | MAE as % of capacity | 2.62% | 7.12% |
| **RMSE** (Root Mean Square Error) | Penalises large errors more | 117.37 MW | 139.62 MW |
| **Skill vs Physics** | How much ML improves over physics-only | 6.39% | 6.81% |
| **PI Coverage** | What fraction of actuals fell inside P10–P90 | 85.74% | 81.92% |
| **PI Nominal** | The target coverage | 80% | 80% |

### What the Metrics Mean in Plain English

- **MAE of 44 MW** at a 2,245 MW solar park → on average, the forecast is off by about 2% of capacity
- **PI Coverage of 85.7%** against a nominal 80% → the uncertainty bands are slightly conservative (which is deliberate — a band that's too wide is honest; one that's too narrow is dangerous)
- **Skill of 6.4%** → the ML layer reduces physics-only error by 6.4%. This is genuine because the target is a residual — the ML cannot take credit for what physics already got right

### Ground Truth Disclosure

The "actuals" the model trained against are **synthetic** — generated by running the physics model and then adding realistic noise (soiling, outages, sub-hourly cloud variability). This is disclosed on every screen that shows accuracy.

What is **real**: the weather the forecast saw (archived forecasts from Open-Meteo), the weather error growth with lead time, and the physics.

What is **simulated**: the plant's own imperfections (soiling, outages, sub-hourly variability).

---

## 16. Every Page in the App

### Command Centre (`/`)

**"What is happening now?"**

- Fleet-wide summary: total generation across all sites
- Per-site headline cards with P50 forecast and capacity factor
- Risk event summary (Critical → Watch)
- Current block indicator and revision horizon
- Quick links to each site's forecast and despatch plan

### Portfolio (`/fleet`)

**"How is the whole fleet performing?"**

- Table of all five sites with today's energy forecast (P10/P50/P90 MWh)
- Peak MW forecast and the block it occurs in
- Mean capacity factor
- Technology and capacity breakdown

### Site Forecast (`/sites/[siteId]`)

**"What will this specific site produce?"**

- Interactive chart: P10/P50/P90 band over the despatch day
- Physics baseline overlay
- Weather conditions per block (temperature, cloud cover, wind, GHI)
- Block-by-block table with all values
- Horizon selector for 24/48/72-hour views

### Site Despatch Plan (`/sites/[siteId]/decisions`)

**"What should we do about the forecast?"**

- Schedule vs. forecast deviation chart
- Risk events panel with severity scores and physical drivers
- Recommended actions ranked by cost (merit order)
- Battery state-of-charge timeline
- Copilot narration of the plan

### Simulator (`/simulator`)

**"What if we changed X?"**

- Scenario configuration: battery size, evacuation limit, etc.
- Side-by-side baseline vs. scenario comparison
- Delta table showing improvement/worsening
- Cost and CO₂ impact
- Break-even analysis

### Historical Data (`/ingest`)

**"Upload actual generation data"**

- CSV upload with auto-detect
- Preview and validation
- Commit to database
- View ingested history

### Accuracy (`/accuracy`)

**"How good is the model?"**

- Accessible via footer link (secondary navigation)
- All metrics from § 15 above
- Ground truth disclosure
- Per-technology breakdown

---

## 17. Every Key Formula

### Solar Physics

```
1. Sun Position:
   declination = 0.006918 − 0.399912·cos(γ) + 0.070257·sin(γ) − ...
   where γ = 2π/365 × (day_of_year − 1 + (hour − 12)/24)

2. Equation of Time:
   EoT = 229.18 × (0.000075 + 0.001868·cos(γ) − 0.032077·sin(γ) − ...)

3. True Solar Time:
   TST = hour × 60 + EoT + 4 × longitude − 60 × UTC_offset

4. Zenith Angle:
   cos(zenith) = sin(lat)·sin(decl) + cos(lat)·cos(decl)·cos(hour_angle)

5. Clear-Sky GHI (Haurwitz 1945):
   GHI_clear = 1098 × cos(z) × exp(−0.059 / cos(z))

6. Clear-Sky Index:
   CSI = GHI_actual / GHI_clear     (clipped to [0, 1.2])

7. Air Mass (Kasten & Young 1989):
   AM = 1 / (cos(z) + 0.50572 × (96.07995 − z)^−1.6364)

8. Plane of Array:
   POA = DNI·cos(AOI) + DHI·(1+cos(tilt))/2 + GHI·albedo·(1−cos(tilt))/2

9. Cell Temperature:
   T_cell = T_ambient + (45 − 20)/800 × POA × wind_cooling

10. DC Power:
    P_dc = Capacity × DC/AC × (POA/1000) × (1 − 0.0038 × (T_cell − 25))

11. AC Power:
    P_ac = min(P_dc × η_inverter, Nameplate) × (1 − losses)
```

### Wind Physics

```
1. Wind Shear:
   V_hub = V_ref × (H_hub / H_ref)^α
   α = ln(V_100 / V_10) / ln(10)    (measured, not assumed)

2. Air Density:
   ρ = P / (287.05 × T_kelvin)

3. Density-Corrected Speed:
   V_corrected = V_hub × ∛(ρ / 1.225)

4. Power:
   P = Capacity × f(V_corrected) × (1 − wake_loss) × availability
   where f() is the normalised power curve lookup
```

### Decision Engine

```
Deficit  = max(Schedule − P10, 0)
Surplus  = max(P90 − Schedule, 0)
Curtailment = max(P90 − Evacuation_limit, 0)

Severity = 100 × [0.45 × mag/0.2cap + 0.25 × hours/6 + 0.15 × TOD + 0.15 × width/0.3cap]
```

### ML Training

```
Pinball Loss:
  L(y, ŷ, α) = α × max(y − ŷ, 0) + (1 − α) × max(ŷ − y, 0)

Target:
  y = actual_CF − physics_CF

Final Forecast:
  P10 = Physics_MW + LightGBM_P10_residual × Capacity
  P50 = Physics_MW + LightGBM_P50_residual × Capacity
  P90 = Physics_MW + LightGBM_P90_residual × Capacity
```

### Energy Accounting

```
MWh = Σ (MW per block) / 4     ← because each block is 15 minutes = 1/4 hour
```

---

## 18. Glossary of Every Term

| Term | Definition |
|------|-----------|
| **ABT/DSM** | Availability Based Tariff / Deviation Settlement Mechanism — the Indian regulatory framework for settling deviations between scheduled and actual generation |
| **Air Mass** | The length of atmosphere that sunlight passes through, relative to straight overhead. More atmosphere = more absorption |
| **Azimuth** | Compass direction (0° = North, 90° = East, 180° = South, 270° = West) |
| **Block** | A 15-minute period in the Indian despatch day. Block 1 = 00:00–00:15. 96 blocks per day |
| **Capacity Factor (CF)** | Actual output / Maximum possible output. 0.25 means the plant produced 25% of its nameplate capacity |
| **CERC** | Central Electricity Regulatory Commission — India's power regulator |
| **Clear-Sky Index (CSI)** | Ratio of measured GHI to theoretical clear-sky GHI. 1.0 = perfectly clear, 0.3 = very cloudy |
| **Curtailment** | Deliberately reducing output because the grid can't absorb it (e.g., wires are full) |
| **Cut-in Speed** | Minimum wind speed to start generating (~3 m/s) |
| **Cut-out Speed** | Maximum safe wind speed — turbine shuts down to protect itself (~25 m/s) |
| **DC/AC Ratio** | How much the solar array is oversized vs. the inverter. 1.25 means 25% more panels than the inverter can handle, causing "clipping" at peak |
| **Declaration** | The power output a generator promises the grid for each block |
| **Declination** | The sun's latitude — how far north or south of the equator the sun appears. Varies ±23.44° over a year |
| **Deficit** | When expected output (P10) falls below the declared schedule |
| **Despatch Day** | The 96-block day starting at 00:00 IST. All scheduling is organised around this unit |
| **DHI** | Diffuse Horizontal Irradiance — scattered sunlight from the sky (not direct beam) |
| **DNI** | Direct Normal Irradiance — the direct beam from the sun, measured perpendicular to the beam |
| **Equation of Time** | The difference between solar time and clock time caused by Earth's elliptical orbit and tilted axis. Up to ±16 minutes |
| **Evacuation Limit** | How much power the transmission lines can carry away from the plant. Below nameplate at every large park |
| **GHI** | Global Horizontal Irradiance — total sunlight on a horizontal surface (GHI = DNI·cos(zenith) + DHI) |
| **Hub Height** | The height of a wind turbine's rotor centre. 80–120m for modern turbines |
| **IEC Class** | International Electrotechnical Commission wind turbine classes. Class I = high wind, Class III = low wind |
| **IST** | Indian Standard Time (UTC+5:30) |
| **LightGBM** | Light Gradient Boosting Machine — a fast, efficient gradient boosting framework that uses decision trees |
| **MAE** | Mean Absolute Error — average of |actual − predicted| across all data points |
| **Merit Order** | Ranking of backup options from cheapest to most expensive |
| **NMAE** | Normalised MAE — MAE divided by capacity, expressed as percentage |
| **NOCT** | Nominal Operating Cell Temperature — the cell temperature under standardised conditions (800 W/m², 20°C ambient, 1 m/s wind) |
| **P10** | The 10th percentile — there's a 10% chance actual output is below this value |
| **P50** | The 50th percentile (median) — equal chance of being above or below |
| **P90** | The 90th percentile — there's only a 10% chance output is above this value |
| **Pinball Loss** | The loss function used to train quantile regression models. Asymmetrically penalises errors based on the target quantile |
| **PI Coverage** | Prediction Interval Coverage — what fraction of actual values fell within the P10–P90 band |
| **POA** | Plane of Array irradiance — total sunlight on the tilted solar panel surface |
| **PPA** | Power Purchase Agreement — the contract price at which a plant sells its power |
| **Quantile** | A statistical cut point. The P10 quantile is the value below which 10% of observations fall |
| **Rated Speed** | Wind speed at which a turbine reaches its maximum power output (~11–13 m/s) |
| **Residual** | The difference between the physics prediction and reality. This is what Stage B learns |
| **Revision Horizon** | The first block that can still be changed by a schedule revision |
| **RLDC** | Regional Load Despatch Centre — operates the regional grid |
| **RMSE** | Root Mean Square Error — √(average of squared errors). Penalises large errors more than MAE |
| **Round-Trip Efficiency** | Energy out / Energy in for a battery. 0.88 means 12% is lost as heat |
| **Shear Exponent (α)** | How wind speed changes with height. Higher α = more difference between ground and hub |
| **Single-Axis Tracking** | Solar panels that rotate east to west following the sun, broadening the daily power curve |
| **Soiling** | Dust and dirt accumulating on solar panels, reducing output. Severe in Indian deserts between monsoons |
| **STC** | Standard Test Conditions — 1000 W/m², 25°C cell temperature, AM 1.5. The benchmark for solar panel ratings |
| **Surplus** | When expected output (P90) exceeds the declared schedule |
| **Temperature Coefficient** | How much a solar cell's power drops per degree above 25°C. Typically −0.38%/°C for crystalline silicon |
| **Wake Loss** | Power loss from downwind turbines seeing slower, more turbulent air |
| **Zenith** | The angle between the sun and directly overhead. 0° = sun overhead, 90° = sun on horizon |

---

## 19. Why These Technology Choices

### Backend: FastAPI (Python)

- **Why Python**: NumPy, pandas, scikit-learn, LightGBM, joblib — the entire ML/scientific stack is Python-native
- **Why FastAPI**: async, type-safe, auto-documentation, production-ready. Flask would work but lacks type validation
- **Why not Django**: too much framework for an API-only backend

### ML: LightGBM

- **Why not XGBoost**: LightGBM is faster for this data volume and handles categorical features natively
- **Why not random forest**: no quantile regression support out of the box
- **Why not deep learning**: tabular data with ~500K rows — gradient boosting wins empirically, trains in minutes not hours, and is interpretable

### Frontend: Next.js 16 + React 19

- **Why Next.js**: server-side rendering (SSR) for SEO and fast first paint, API routes, file-based routing
- **Why not plain React**: would need a separate router, SSR setup, and build config
- **Why not Vue/Svelte**: React has the largest ecosystem for data visualisation components

### Styling: Tailwind CSS 4

- **Why Tailwind**: utility-first means no CSS naming conflicts across 30+ components
- **Why not plain CSS**: would be maintainable but slower to develop at this scale

### Animation: Motion (Framer Motion)

- **Why Motion**: the most mature React animation library, supports `layoutId` for shared element transitions, respects `prefers-reduced-motion`
- **Why not CSS-only**: page transitions and shared layout animations need JS coordination

### Weather: Open-Meteo

- **Why not ECMWF direct**: requires a paid account and data license
- **Why not AccuWeather/OpenWeatherMap**: don't provide archived *forecasts* (only reanalysis or current conditions), and require API keys
- **Why Open-Meteo**: free, no key, provides both live and archived forecasts, returns all the irradiance components (GHI/DNI/DHI) that solar modelling needs

### Database: SQLite (via Python's built-in `sqlite3`)

- **Why SQLite**: zero configuration, file-based, perfect for a single-server deployment
- **Why not PostgreSQL**: unnecessary complexity for 5 sites and ~500K rows. If RenewCast scaled to 1,000 sites, PostgreSQL would be the right upgrade

---

*This document was generated from the RenewCast codebase on 2026-09-13. Every formula, algorithm, and design decision described here is implemented in the production code and verified by the test suite.*
