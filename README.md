<div align="center">

# ⚡ RenewCast

### Probabilistic Renewable Energy Forecasting & Despatch Decision Platform

**Forecasting isn't predicting a number — it's predicting a *range*, and then telling you what to do about it.**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![LightGBM](https://img.shields.io/badge/LightGBM-02569B?style=for-the-badge&logo=microsoft&logoColor=white)](https://lightgbm.readthedocs.io)
[![Tailwind](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

<br>

**HackOut'26** · **Team TriHack** · L.D. College of Engineering

**Kunj Vaghani** · **Laksh Tank** · **Nishtha Shah**

<br>

[🚀 Quick Start](#-quick-start) · [📖 Documentation](#-documentation) · [🧪 How It Works](#-how-the-forecast-works) · [📊 Results](#-measured-performance)

</div>

---

## 🎯 The Problem

India's electricity grid runs on a **schedule**. Every renewable power plant files a "declaration of capability" — a block-by-block promise of how much power it will produce. If actual generation deviates significantly, the plant faces **financial penalties** under the ABT/DSM framework.

**The catch?** You cannot control the sun or wind.

A cloud covers Bhadla Solar Park and suddenly you're 200 MW below schedule. Wind dies at Muppandal and your turbines stop. These aren't equipment failures — they're weather. And the grid doesn't care *why* you missed; it cares *that* you missed.

**RenewCast bridges this gap:**

> **Weather forecast → Power forecast → Deviation analysis → Priced action plan → Plain-language explanation**
>
> All in one pipeline, in real time, for 5 real Indian sites.

---

## ✨ Key Features

<table>
<tr>
<td width="50%">

### 🔮 Probabilistic Forecasting
72-hour generation forecast as **P10 / P50 / P90** — not a single number but a calibrated uncertainty band. The operator sees the best case, the expected case, and the worst case.

### ⚡ Despatch Decision Engine
Compares forecast against declared schedule, identifies deficit/surplus/curtailment risks, simulates battery dispatch, and recommends **priced actions** in merit order.

### 🎯 Severity-Scored Risk Events
Groups contiguous risky blocks into **operational events**, scores them 0–100, attributes a **physical driver** (cloud cover, wind drop, thermal derate), and recommends a response.

</td>
<td width="50%">

### 🧪 What-If Simulator
Change battery size, evacuation limit, or backup capacity and instantly see the impact on curtailment, cost, and CO₂ — with break-even analysis.

### 🤖 AI Copilot
Plain-language narration of the despatch plan powered by **Gemini AI**. Every number is pre-computed; the LLM phrases, it never calculates. Falls back to deterministic templates with no API key.

### 📊 Historical Data Ingestion
Upload actual generation CSVs. Auto-detects columns, validates data, maps to 15-minute blocks, and stores for accuracy benchmarking.

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                 │
│        Next.js 16  ·  React 19  ·  Tailwind CSS 4  ·  Motion   │
│                    http://localhost:3000                         │
├─────────────────────────────────────────────────────────────────┤
│                         │  REST API  │                          │
├─────────────────────────────────────────────────────────────────┤
│                        BACKEND                                  │
│             FastAPI  ·  LightGBM  ·  NumPy/Pandas               │
│                    http://localhost:8000                         │
├────────────┬────────────┬───────────┬───────────┬───────────────┤
│  Forecast  │ Decisions  │ Simulator │  Copilot  │    Ingest     │
│  Service   │   Engine   │  Service  │  Service  │   Service     │
├────────────┴────────────┴───────────┴───────────┴───────────────┤
│                     CORE MODULES                                │
│     Physics Engine  ·  Astronomy  ·  Time Blocks  ·  Features   │
├─────────────────────────────────────────────────────────────────┤
│                   EXTERNAL SERVICES                             │
│    Open-Meteo (live + archived weather, free, no API key)       │
│    Google Gemini (optional, for copilot narration)              │
└─────────────────────────────────────────────────────────────────┘
```

### The Two-Stage Forecast Pipeline

```
Live Weather (Open-Meteo, hourly)
  └→ Interpolated to 15-min blocks
       └→ Feature Engineering (22 features per technology)
            └→ Stage A: Deterministic Physics (sun/wind → MW)
                 └→ Stage B: LightGBM Quantile Residual Correction
                      └→ P10 / P50 / P90 forecast in MW per block
                           └→ Decision Engine → Priced Actions
                                └→ Copilot → Plain-Language Summary
```

**Stage A** is pure physics — it works on a fresh clone with no trained models. **Stage B** learns the residual between physics and reality, so the ML output is interpretable: *"physics said 1,800 MW, history says knock 6% off a hazy April afternoon."*

---

## 🌍 The Five Sites

| Site | State | Technology | Capacity | Evacuation Limit | Battery | Distinctive Feature |
|:-----|:------|:-----------|:---------|:-----------------|:--------|:-------------------|
| **Bhadla Solar Park** | Rajasthan | Solar (fixed) | 2,245 MW | 2,000 MW | 100 MW / 400 MWh | World's largest solar park; Thar desert dust |
| **Pavagada (Shakti Sthala)** | Karnataka | Solar (tracking) | 2,050 MW | 1,900 MW | 50 MW / 200 MWh | Single-axis trackers broaden daily curve |
| **Charanka Solar Park** | Gujarat | Solar (fixed) | 790 MW | 750 MW | None | India's first large park (2012) |
| **Muppandal Wind Farm** | Tamil Nadu | Wind | 1,500 MW | 1,300 MW | None | Monsoon gap winds so strong TN curtails |
| **Jaisalmer Wind Park** | Rajasthan | Wind | 1,064 MW | 1,000 MW | 60 MW / 240 MWh | 100m hub height, IEC Class II |

> Coordinates and capacities are public record. Evacuation limits, tariffs, and battery sizes are **engineering assumptions** marked "Indicative — configurable" throughout the product.

---

## 🧪 How the Forecast Works

### Stage A — Physics (No Training Data Required)

| Solar | Wind |
|:------|:-----|
| NOAA solar position equations (zenith, azimuth, elevation) | Power-law wind shear extrapolation (10m to hub height) |
| Plane-of-array irradiance (Liu and Jordan isotropic model) | Air-density correction via ideal gas law |
| Cell temperature via NOCT method (wind-cooling corrected) | Real turbine power curve (Vestas V90 normalised table) |
| Temperature derating (0.38%/C above 25C) | Cut-in / rated / cut-out speed thresholds per IEC class |
| Inverter clipping at DC/AC ratio | Wake losses and availability derating |
| System losses (soiling, wiring, mismatch: 13-17%) | — |

### Stage B — Machine Learning

**Algorithm:** LightGBM gradient boosting with quantile regression (pinball loss).

**Target:** `actual_capacity_factor - physics_capacity_factor` (the residual, not MW).

**Why the residual?**
- **Scale-free:** 2,245 MW Bhadla and 790 MW Charanka become comparable
- **Centred near zero:** far easier to fit than a range of 0-2,245
- **Interpretable:** *"physics said X, model shaves Y%"*

**Three independent models**, each trained on a different quantile:
- **P10 model** (alpha = 0.10) — penalised 9x more for overestimating, learns the pessimistic case
- **P50 model** (alpha = 0.50) — penalised equally, learns the median
- **P90 model** (alpha = 0.90) — penalised 9x more for underestimating, learns the optimistic case

### The Zero-Leak Guarantee

> No feature may be derived from the target. No lag of generation, no rolling mean of output, no "yesterday's peak."

A target lag correlates ~0.99 at 15-minute resolution — the model scores beautifully and has learned *persistence* rather than *forecasting*. It collapses at a 72-hour horizon. `tests/test_no_leak.py` enforces this by inspecting feature names automatically.

### Feature Engineering (22 features per technology)

**Solar-specific:** GHI, DNI, DHI, clear-sky index, solar elevation, air mass, diffuse fraction, GHI ramp, cloud ramp, clear-sky variability

**Wind-specific:** wind at 10m and 100m, gusts, wind direction, shear ratio, turbulence intensity, air density, wind ramp, wind variability, v cubed

**Shared:** physics capacity factor, lead time, temperature, humidity, cloud cover, precipitation, pressure, cyclical hour/day encoding

---

## 📊 Measured Performance

Held-out validation against archived *forecast* weather (not reanalysis — so error growth with lead time is real):

| Technology | Skill vs Physics | nMAE | Physics Alone | P10-P90 Coverage | Training Rows |
|:-----------|:----------------|:-----|:-------------|:-----------------|:-------------|
| **Solar** | **6.39%** | 2.62% | 2.80% | 85.7% (target: 80%) | 673,656 |
| **Wind** | **6.81%** | 7.12% | 7.64% | 81.9% (target: 80%) | 449,104 |

- **Skill over physics** is the metric that matters — a model can post a low MAE while adding nothing to a good physics baseline
- Both intervals are **slightly conservative** (wider than nominal) — the safe direction when planning against P10
- Coverage above nominal means operators can trust the bands

> **Honest limitation:** Ground truth is a synthetic plant response over real archived weather, because block-level metered output for these sites is not public. The physics and weather are real; the plant's measured response is modelled. This is disclosed on every screen that reports accuracy.

---

## Decision Engine

The engine turns a probability band into **priced, ranked instructions:**

```
Schedule - P10   = Deficit risk     (how much you might fall short)
P90 - Schedule   = Surplus risk     (how much you might overproduce)
P90 - Evac Limit = Curtailment risk (what the wires cannot carry)
```

### Merit Order (cheapest first)

| Situation | Priority | Action | Cost (Rs/MWh) | CO2 Impact |
|:----------|:---------|:-------|:-------------|:-----------|
| **Surplus** | 1st | Battery charge | 4,500 | -0.71 t (avoided) |
| | 2nd | Curtailment | Revenue forgone | Grid replaces |
| **Deficit** | 1st | Battery discharge | 4,500 | -0.71 t (avoided) |
| | 2nd | Gas peaker | 8,000 | +0.45 t |
| | 3rd | Diesel (last resort) | 22,000 | +0.75 t |

Battery is simulated **block-by-block, greedily, forward in time** — sequential because state of charge couples every block to the one before it. Round-trip efficiency (88%) is charged once on the way in.

### Severity Scoring (0-100)

```
severity = 100 x [0.45 x magnitude + 0.25 x duration + 0.15 x time_of_day + 0.15 x uncertainty]
```

| Score | Level | Meaning |
|:------|:------|:--------|
| 0-24 | Good | Normal operations |
| 25-49 | Watch | Monitor closely |
| 50-74 | Serious | Action recommended |
| 75-100 | Critical | Immediate action required |

Each event is attributed a **physical driver**: *"Dense cloud cover (72%) suppressing solar irradiance"* or *"Hub-height wind 2.1 m/s below cut-in threshold"*.

---

## 🚀 Quick Start

### Prerequisites

- **Python** 3.11+
- **Node.js** 20+
- **Git**

### 1. Clone

```bash
git clone https://github.com/NishthaShah01/RenewCast.git
cd RenewCast
```

### 2. Backend

Models are committed to the repo — boot is a file load, not a training run.

```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate
# Activate (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Configure (optional — works without .env)
cd backend
cp .env.example .env

# Start the API server
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend (in a second terminal)

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

### 4. Open

| Service | URL |
|:--------|:----|
| **App** | http://localhost:3000 |
| **API Docs** | http://localhost:8000/api/docs |
| **Health Check** | http://localhost:8000/api/health |

> The Gemini API key is optional. Leave `GEMINI_API_KEY` blank and the copilot answers deterministically — everything else is fully functional.

---

## 🧪 Testing

```bash
cd backend
python -m pytest
```

The test suite includes:
- **`test_no_leak.py`** — enforces the zero-leak guarantee by inspecting feature names
- Physics validation against published solar position data
- Time-block arithmetic consistency checks
- API endpoint integration tests

---

## 🌐 Deployment

| Component | Platform | Configuration |
|:----------|:---------|:-------------|
| **Backend** | Render | `render.yaml` — Singapore region (closest to India) |
| **Frontend** | Vercel | `frontend/vercel.json` |

**Environment variables:**

| Variable | Where | Required | Purpose |
|:---------|:------|:---------|:--------|
| `NEXT_PUBLIC_API_URL` | Vercel | Yes | Points frontend to the Render API URL |
| `GEMINI_API_KEY` | Render | No | Enables LLM copilot narration |
| `GEMINI_MODEL` | Render | No | Default: `gemini-3.5-flash-lite` |
| `ALLOWED_ORIGINS` | Render | Auto-set | CORS origins for frontend |

> Render's free tier sleeps after ~15 minutes idle, so the first request after a quiet spell takes ~50s to wake.

---

## 📁 Repository Structure

```
RenewCast/
├── backend/                    FastAPI backend
│   ├── app/
│   │   ├── core/
│   │   │   ├── astronomy.py        Solar position (NOAA equations)
│   │   │   ├── physics.py          Plant power models (solar + wind)
│   │   │   └── timeblocks.py       96-block despatch day arithmetic
│   │   ├── data/
│   │   │   ├── constants.py        Physical + commercial constants
│   │   │   └── sites.py            5-site registry with plant specs
│   │   ├── features/
│   │   │   ├── build.py            Feature engineering pipeline
│   │   │   └── synthetic_actuals.py Ground truth generation
│   │   ├── services/
│   │   │   ├── forecast.py         Two-stage forecast assembly
│   │   │   ├── decisions.py        Despatch decision engine
│   │   │   ├── simulator.py        What-if scenario engine
│   │   │   ├── copilot.py          AI narration (Gemini + templates)
│   │   │   ├── weather.py          Open-Meteo client
│   │   │   └── ingest.py           CSV ingestion service
│   │   ├── routers/                API endpoints
│   │   ├── schemas.py              Pydantic response models
│   │   └── store.py                Data persistence layer
│   ├── models/                     Pre-trained LightGBM models (.joblib)
│   └── tests/                      Including the no-leak guard
│
├── frontend/                   Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            Command Centre (fleet dashboard)
│   │   │   ├── fleet/              Portfolio view
│   │   │   ├── sites/              Site forecast + despatch plans
│   │   │   ├── simulator/          What-if simulator
│   │   │   ├── ingest/             Historical data upload
│   │   │   └── accuracy/           Model validation metrics
│   │   ├── components/             Reusable UI components
│   │   └── lib/
│   │       ├── api.ts              Centralised API client
│   │       └── blocks.ts           Block arithmetic (mirrors backend)
│   └── public/                     Logos, favicons, assets
│
├── EXPLAIN.md                  Full technical explanation (plain language)
├── README_PROJECT.md           System build contract and API surface
├── README_UI.md                UI contract — tokens, components, states
└── render.yaml                 Deployment blueprint
```

---

## 📖 Documentation

| Document | Purpose |
|:---------|:--------|
| **EXPLAIN.md** | Complete plain-language explanation — every term, formula, algorithm, and design decision |
| **README_PROJECT.md** | System architecture — data flow, API surface, module responsibilities |
| **README_UI.md** | Interface contract — colour tokens, components, states, accessibility |

---

## 🔑 Design Decisions

<details>
<summary><strong>Why archived forecasts, not reanalysis?</strong></summary>
<br>
Reanalysis (ERA5) is the best retrospective estimate of what the weather actually was. It is the wrong training source. At serving time, the model sees a forecast — which is wrong, systematically, in ways that worsen with lead time. A model trained on perfect weather has no idea that a 3-day-ahead GHI number tends to run optimistic. It will look excellent in validation and mediocre in production. Open-Meteo's archived-forecast API returns what was actually predicted at the time.
</details>

<details>
<summary><strong>Why quantile regression, not confidence intervals?</strong></summary>
<br>
The model predicts the 10th, 50th, and 90th percentiles of generation, not of the estimate's error. These are the percentiles that bind to operational decisions: deficit risk against P10, surplus against P90, energy accounting at P50. Each quantile is an independently trained model with its own asymmetric loss function.
</details>

<details>
<summary><strong>Why a normalised power curve, not v cubed?</strong></summary>
<br>
The textbook cubic formula is badly wrong in the operating range: at 7 m/s with a 13 m/s rated speed it returns 5% of rated power; the real turbine delivers 29%. The physical reason is that the power coefficient Cp varies across the operating range. Using a digitised real turbine curve (Vestas V90) eliminated a ~20x error at Muppandal.
</details>

<details>
<summary><strong>Why greedy battery dispatch, not optimal?</strong></summary>
<br>
A full linear-programme dispatch would squeeze out a few more percent by holding charge for a more valuable block — but it would also produce a plan no operator could explain, and it would need a price forecast we do not have. Greedy is what a control room does: absorb the surplus in front of you, cover the shortfall in front of you.
</details>

<details>
<summary><strong>Why the copilot never calculates?</strong></summary>
<br>
Every number in the copilot's answer is computed by the decision engine and interpolated into the prompt. The LLM sequences and phrases, it never does arithmetic. An LLM that is allowed to compute will eventually get a number wrong in a way that reads perfectly fluently — and a fluent wrong number in a despatch plan is worse than no answer at all.
</details>

---

## 📝 Notes on the Numbers

- **Commercial coefficients** (tariffs, battery LCOS, peaker costs, emission factors) are documented defaults, not quoted market rates. They are defined in `backend/app/data/constants.py` and labelled "Indicative" on every page.
- **The declared-schedule curve is simulated**, not a filed schedule. Every API response includes `schedule_basis` saying so, and the UI renders it as a caveat.
- **Fleet-level P10/P90** is the sum of site intervals. Since site forecast errors are only partly correlated, this is a conservative bound rather than a calibrated fleet interval — stated on screen.

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|:------|:-----------|:----|
| **Backend** | FastAPI (Python 3.11) | Async, type-safe, auto-docs; Python for ML/scientific ecosystem |
| **ML** | LightGBM | Fastest gradient boosting for tabular data; native quantile loss |
| **Physics** | NumPy | Vectorised solar/wind models over 288 blocks |
| **Frontend** | Next.js 16 + React 19 | SSR, file-based routing, largest component ecosystem |
| **Styling** | Tailwind CSS 4 | Utility-first, no naming conflicts across 30+ components |
| **Animation** | Motion (Framer Motion) | Layout animations, prefers-reduced-motion support |
| **Weather** | Open-Meteo | Free, no key, live + archived forecasts, GHI/DNI/DHI |
| **AI** | Google Gemini | Optional copilot narration; deterministic fallback |
| **Deployment** | Render + Vercel | Free tier, Singapore region, config-as-code |

---

<div align="center">

**Built with ❤️ for HackOut'26**

*RenewCast — because the grid doesn't care why you missed. It cares that you had a plan.*

</div>
