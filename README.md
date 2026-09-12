# RenewCast

**Probabilistic renewable generation forecasting for the Indian grid, aligned to the 96-block despatch day.**

HackOut'26 · Team TriHack · L.D. College of Engineering
Kunj Vaghani · Laksh Tank · Nishtha Shah

---

A wind farm operator does not need to know that tomorrow will be windy. They need
to know how much capability to declare for block 47, whether they can still revise
it, and what it costs if they are wrong. RenewCast forecasts generation at the
resolution the grid actually schedules in, then turns the forecast into a despatch
decision with a price attached.

## What it does

**Forecasts 72 hours ahead, in 15-minute blocks.** Indian grid scheduling runs on 96
blocks per day from 00:00 IST. Every time-series surface in the app shares that
x-axis, so horizontal position means the same thing everywhere.

**Forecasts a range, not a number.** Output is P10 / P50 / P90. A point forecast
tells an operator what to expect; an interval tells them what to plan against. The
asymmetry is deliberate and consistent: shortfall risk is measured against **P10**
(the credible floor), surplus and curtailment against **P90** (the credible
ceiling), and energy accounting against **P50**.

**Respects the revision horizon.** A voluntary revision takes effect from the 6th
block ahead, an RLDC-initiated one from the 4th. Blocks inside that window are shown
dimmed and labelled *Locked* — never hidden, because an operator needs to see what
they can no longer change.

**Recommends, prices, and ranks.** Deficit, surplus and curtailment each produce
ranked actions — charge or discharge the battery, start the gas peaker, curtail —
with energy, cost in ₹, and CO₂ for each. Merit order is by cost, so the cheapest
remedy leads.

**Explains itself in plain language.** The copilot narrates the plan. Every number
it states is computed by the decision engine and handed to the model in a fact
block; the model sequences and phrases, it never calculates. With no API key it
falls back to a deterministic explainer over the same facts — a supported mode, not
a degraded one, and the API says which one answered.

## How the forecast works

Two stages, because neither alone is honest.

**Stage A — physics.** Clear-sky irradiance, solar geometry and air mass for solar;
a real turbine power curve with air-density correction for wind. Deterministic, and
correct at the boundaries where ML is weakest: it knows a solar farm produces
nothing at midnight without ever having seen midnight.

**Stage B — learned residual.** LightGBM quantile regression predicts the *error*
in Stage A's capacity factor, at three quantiles. Modelling the residual rather than
the output means the model spends its capacity on what physics cannot express —
soiling, wake losses, curtailment behaviour — instead of relearning the sun.

**No target lags.** Not one feature derives from past generation. A model given
yesterday's output scores beautifully in validation and is useless at a 72-hour
horizon, where no recent actuals exist. `tests/test_no_leak.py` enforces this; it is
a test, not a convention.

### Measured performance

Held-out validation against archived *forecast* weather at four lead times — so
error growth with lead time is real, not an artefact of scoring against reanalysis
the model would never see in production.

| | Skill over physics | nMAE | Physics alone | P10–P90 coverage |
|---|---|---|---|---|
| **Solar** | **6.39%** | 2.62% | 2.80% | 85.7% (nominal 80%) |
| **Wind** | **6.81%** | 7.12% | 7.64% | 81.9% (nominal 80%) |

**Skill over physics is the number that matters.** A model can post a respectable
MAE while adding nothing to a good physics baseline. Both intervals are wider than
nominal — conservative, which is the safe direction to be wrong in when an operator
is planning against P10.

> **Honest limitation.** Ground truth is a synthetic plant response over real
> archived weather, because block-level metered output for these sites is not
> public. The physics and the weather are real; the plant's measured response is
> modelled. Read the error figures as a bound on the method, not a field-validated
> claim about these specific plants. The app states this on screen too, rather than
> only in the README.

## Running it

**Prerequisites:** Python 3.11+, Node 20+.

```bash
git clone https://github.com/NishthaShah01/RenewCast.git
cd RenewCast
```

**Backend** — models are committed, so this is a file load, not a training run.

```bash
python -m venv .venv && source .venv/Scripts/activate
pip install -r backend/requirements.txt
cd backend && cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

**Frontend** — in a second terminal:

```bash
cd frontend && npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`. API docs are at `http://localhost:8000/api/docs`.

The Gemini key is optional. Leave `GEMINI_API_KEY` blank and the copilot answers
deterministically; everything else is unaffected.

### Tests

```bash
cd backend && python -m pytest
```

## Deployment

Frontend on Vercel, backend on Render, both configured in-repo — [`render.yaml`](render.yaml)
and [`frontend/vercel.json`](frontend/vercel.json).

Set `NEXT_PUBLIC_API_URL` on Vercel to the Render URL, and `GEMINI_API_KEY` on
Render if you want LLM narration. Render's free tier sleeps after ~15 minutes idle,
so the first request after a quiet spell takes ~50 s to wake.

## Repository

```
backend/       FastAPI · forecasting engine · decision engine · copilot
  app/
    core/      Physics, time blocks, quantile machinery
    data/      Site registry and the commercial/emission constants
    services/  forecast · decisions · copilot · weather
    routers/   sites · forecast · decisions · accuracy · copilot · health
  models/      Committed LightGBM artefacts + metadata.json
  tests/       Including the no-leak guard
frontend/      Next.js · React · Tailwind v4
  src/app/     Fleet · site detail · despatch plan · accuracy
```

**Design and architecture documents:** [`README_PROJECT.md`](README_PROJECT.md) is
the system build contract — data flow, API surface, module responsibilities.
[`README_UI.md`](README_UI.md) is the interface contract — every colour token with
its measured contrast ratio, every component, every state, every word.

## Notes on the numbers

Commercial coefficients — tariffs, battery LCOS, peaker cost, emission factors —
are documented defaults, not quoted market rates, and are defined in one place,
`backend/app/data/constants.py`. They are labelled as indicative in the footer of
every page.

The declared-schedule curve is **simulated**, not a filed schedule; the API returns
`schedule_basis` saying so on every response, and the UI renders it as a caveat.

Fleet-level P10/P90 is the sum of site intervals. Site forecast errors are only
partly correlated, so that sum is a conservative bound rather than a calibrated
fleet interval — stated on screen where it appears.
