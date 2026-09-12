"""Physical and commercial constants.

Two rules govern this file:

1. **Every commercial coefficient is INDICATIVE and configurable.** They are
   order-of-magnitude figures for Indian conditions, not settled tariffs. Each
   is exposed through the site-config API and rendered on screen with an
   "Indicative — configurable" badge. Never present one as authoritative.

2. **Physical constants are physics**, not preferences. Do not tune them to
   make a chart look better.
"""

from __future__ import annotations

from typing import Final

# ═════════════════════════════════════════════════════════════════════════
# PHYSICAL CONSTANTS
# ═════════════════════════════════════════════════════════════════════════

SOLAR_CONSTANT_W_M2: Final[float] = 1361.0
"""Extraterrestrial solar irradiance at mean Earth-Sun distance (W/m²)."""

STANDARD_AIR_DENSITY: Final[float] = 1.225
"""Sea-level air density at 15 °C (kg/m³). Turbine power curves are rated
against this, so real output must be density-corrected."""

SPECIFIC_GAS_CONSTANT_DRY_AIR: Final[float] = 287.05
"""J/(kg·K), for the ideal-gas air-density correction."""

STC_IRRADIANCE: Final[float] = 1000.0
"""Standard Test Conditions irradiance (W/m²) — the denominator of PV output."""

STC_CELL_TEMP_C: Final[float] = 25.0
"""STC cell temperature (°C). PV output is derated above this."""

NOCT_C: Final[float] = 45.0
"""Nominal Operating Cell Temperature (°C), typical crystalline-silicon module."""

NOCT_IRRADIANCE: Final[float] = 800.0
"""Irradiance at which NOCT is defined (W/m²)."""

NOCT_AMBIENT_C: Final[float] = 20.0
"""Ambient temperature at which NOCT is defined (°C)."""

TEMP_COEFF_PMAX_PER_C: Final[float] = -0.0038
"""Power temperature coefficient (fraction per °C). Crystalline silicon loses
roughly 0.38 % of output per °C above 25 °C — which is why a hot, clear
Rajasthan afternoon underperforms a cool, clear morning at equal irradiance."""

WIND_SHEAR_EXPONENT_DEFAULT: Final[float] = 0.143
"""Power-law shear exponent (the '1/7th power law') for extrapolating wind
speed from measurement height to hub height over open terrain."""

# ═════════════════════════════════════════════════════════════════════════
# GRID STRUCTURE — these are regulatory facts, not tunables
# ═════════════════════════════════════════════════════════════════════════

BLOCKS_PER_DAY: Final[int] = 96
"""The Indian despatch day is divided into 96 time blocks of 15 minutes each,
beginning at 00:00. Schedules, declarations of capability and deviation
settlement are all expressed per block."""

BLOCK_MINUTES: Final[int] = 15

RLDC_REVISION_LEAD_BLOCKS: Final[int] = 4
"""An RLDC-initiated schedule revision takes effect from the 4th time block."""

VOLUNTARY_REVISION_LEAD_BLOCKS: Final[int] = 6
"""A voluntary schedule revision takes effect only from the 6th time block —
i.e. 90 minutes of lead time. This is the 'revision horizon': the first block
an operator can still influence. It is the reason a forecast has value only if
it arrives before the gate closes."""

GRID_FREQUENCY_HZ: Final[float] = 50.0

# ═════════════════════════════════════════════════════════════════════════
# COMMERCIAL COEFFICIENTS — ALL INDICATIVE, ALL CONFIGURABLE
# ═════════════════════════════════════════════════════════════════════════

GRID_EMISSION_FACTOR: Final[float] = 0.71
"""tCO₂/MWh — indicative Indian grid average. Displacing grid power with
renewables avoids roughly this much carbon per MWh."""

DIESEL_EMISSION_FACTOR: Final[float] = 0.75
"""tCO₂/MWh for diesel generation — indicative."""

DIESEL_COST_PER_MWH: Final[float] = 22_000.0
"""₹/MWh for diesel backup — indicative. Deliberately the most expensive
option in the merit order, which is why it ranks last."""

GAS_PEAKER_EMISSION_FACTOR: Final[float] = 0.45
"""tCO₂/MWh for an open-cycle gas peaker — indicative."""

GAS_PEAKER_COST_PER_MWH: Final[float] = 8_000.0
"""₹/MWh for gas peaking generation — indicative."""

SOLAR_PPA_TARIFF: Final[float] = 2_500.0
"""₹/MWh — indicative solar PPA rate. Curtailed solar energy is revenue
forgone at this rate."""

WIND_PPA_TARIFF: Final[float] = 3_000.0
"""₹/MWh — indicative wind PPA rate."""

BATTERY_ROUND_TRIP_EFFICIENCY: Final[float] = 0.88
"""Fraction. Energy in versus energy out for a modern Li-ion system."""

BATTERY_LCOS_PER_MWH: Final[float] = 4_500.0
"""₹/MWh levelised cost of storage — indicative."""

THERMAL_MIN_TECHNICAL_LOAD: Final[float] = 0.55
"""Fraction of rated capacity below which a thermal unit cannot be backed
down. Indian units are designed for 70–80 %; many now achieve ~55 % and the
best around 40 %. This is a hard feasibility floor on the 'back down thermal'
action, not a preference."""

# ═════════════════════════════════════════════════════════════════════════
# TURBINE CLASSES — IEC wind classes as power-curve defaults
# ═════════════════════════════════════════════════════════════════════════

TURBINE_CLASSES: Final[dict[str, dict[str, float]]] = {
    # cut_in / rated / cut_out in m/s
    "iec_i": {"cut_in": 3.5, "rated": 13.0, "cut_out": 25.0},
    "iec_ii": {"cut_in": 3.0, "rated": 12.0, "cut_out": 25.0},
    "iec_iii": {"cut_in": 3.0, "rated": 11.0, "cut_out": 22.0},
}

DEFAULT_TURBINE_CLASS: Final[str] = "iec_ii"

# ═════════════════════════════════════════════════════════════════════════
# QUANTILES
# ═════════════════════════════════════════════════════════════════════════

QUANTILES: Final[tuple[float, float, float]] = (0.10, 0.50, 0.90)
"""P10 / P50 / P90. The nominal prediction-interval coverage is therefore 80 %,
which the accuracy page validates against measured coverage.

Decision rules bind to specific quantiles and must not be swapped:
  deficit risk      → assessed against P10 (the pessimistic case)
  surplus/curtail   → assessed against P90 (the optimistic case)
  energy accounting → P50
"""

PI_NOMINAL_COVERAGE: Final[float] = 0.80
