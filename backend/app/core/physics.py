"""Stage A: deterministic plant models.

Given weather and plant geometry, what does the machinery produce? No fitted
parameters. Every coefficient is either a published physical constant or a
plant nameplate figure.

This exists as a separate stage for three reasons that matter more than code
organisation:

1. **It works with no training data.** A fresh clone with no models directory
   still serves forecasts. `/health` reports `degraded`, the UI says "Physics
   only", and the numbers are defensible.
2. **It is the thing the model corrects.** Stage B learns the residual between
   this and reality, so the ML output is interpretable as "physics said 1,800
   MW, history says knock 6% off a hazy April afternoon". A single end-to-end
   regressor would be a black box with the same error.
3. **It cannot leak.** Physics has no access to the target by construction, so
   the leak-free guarantee holds for the majority of the signal regardless of
   what the feature builder does.

Both models are vectorised over numpy arrays of blocks, because a 72-hour
forecast is 288 blocks and per-block Python would dominate the request.
"""

from __future__ import annotations

import numpy as np

from app.core import astronomy
from app.data.constants import (
    NOCT_AMBIENT_C,
    NOCT_C,
    NOCT_IRRADIANCE,
    SPECIFIC_GAS_CONSTANT_DRY_AIR,
    STANDARD_AIR_DENSITY,
    STC_CELL_TEMP_C,
    STC_IRRADIANCE,
    TEMP_COEFF_PMAX_PER_C,
    TURBINE_CLASSES,
)
from app.data.sites import Site

# Ground reflectance. 0.2 is the standard default for vegetation and soil; the
# Thar and Kutch sites are brighter, but ground-reflected irradiance is a few
# percent of the total at these tilts, so the sensitivity is negligible.
GROUND_ALBEDO = 0.20

# Height at which Open-Meteo reports wind speed.
WIND_MEASUREMENT_HEIGHT_M = 10.0

# Standard atmosphere, for deriving pressure from elevation when the weather
# feed gives no surface pressure.
SEA_LEVEL_PRESSURE_PA = 101_325.0
TEMPERATURE_LAPSE_RATE_K_PER_M = 0.0065
STANDARD_SEA_LEVEL_TEMP_K = 288.15
BAROMETRIC_EXPONENT = 5.25588


# ═════════════════════════════════════════════════════════════════════════
# SOLAR
# ═════════════════════════════════════════════════════════════════════════


def plane_of_array_irradiance(
    ghi: np.ndarray,
    dni: np.ndarray,
    dhi: np.ndarray,
    zenith_deg: np.ndarray,
    azimuth_deg: np.ndarray,
    surface_tilt_deg: np.ndarray | float,
    surface_azimuth_deg: np.ndarray | float,
    albedo: float = GROUND_ALBEDO,
) -> np.ndarray:
    """Total irradiance on the tilted module plane, W/m².

    Three components, the isotropic (Liu & Jordan) sky model:

      beam     — DNI projected onto the module normal
      diffuse  — sky radiance assumed uniform, so the module sees the fraction
                 of the sky dome it faces
      reflected— ground-bounced, the fraction of ground the module faces

    The isotropic model slightly underestimates diffuse because real skies are
    brighter near the sun and near the horizon. We accept that: it is a smooth
    systematic bias, which is precisely the kind of error Stage B can learn,
    unlike the random error a more complex model's extra inputs would add.
    """
    aoi = astronomy.angle_of_incidence(
        zenith_deg, azimuth_deg, surface_tilt_deg, surface_azimuth_deg
    )
    # Negative cos(AOI) means the sun is behind the module — no beam, not
    # negative beam.
    cos_aoi = np.maximum(np.cos(np.radians(aoi)), 0.0)

    tilt = np.radians(surface_tilt_deg)
    beam = dni * cos_aoi
    sky_diffuse = dhi * (1.0 + np.cos(tilt)) / 2.0
    ground_reflected = ghi * albedo * (1.0 - np.cos(tilt)) / 2.0

    poa = beam + sky_diffuse + ground_reflected
    # Below the horizon there is no irradiance, whatever the feed interpolated.
    return np.where(astronomy.is_daylight(zenith_deg), np.maximum(poa, 0.0), 0.0)


def cell_temperature(
    poa: np.ndarray,
    ambient_temp_c: np.ndarray,
    wind_speed_ms: np.ndarray | None = None,
) -> np.ndarray:
    """Module cell temperature, °C, by the NOCT method.

    Cells run far hotter than the air around them — 25–35 °C above ambient
    under full sun. At Bhadla in May that means a 45 °C air temperature and a
    75 °C cell, costing about 19% of output to the temperature coefficient
    alone. A model without this term overpredicts every summer afternoon, which
    is when the grid is most stressed and the forecast matters most.

    `wind_speed_ms` applies a convective correction: wind cools modules. It is
    optional because the NOCT method is defined without it, and the correction
    is capped so a windy hour cannot drive cells below ambient.
    """
    rise = (NOCT_C - NOCT_AMBIENT_C) / NOCT_IRRADIANCE * poa

    if wind_speed_ms is not None:
        # NOCT is defined at 1 m/s. Scale the temperature rise by the ratio of
        # convective coefficients, approximated as inversely proportional to
        # the square root of wind speed. Floored at 0.6 so a gale does not
        # eliminate the rise entirely.
        cooling = np.clip(np.sqrt(1.0 / np.maximum(wind_speed_ms, 1.0)), 0.6, 1.0)
        rise = rise * cooling

    return ambient_temp_c + rise


def solar_power_mw(site: Site, weather: dict[str, np.ndarray]) -> np.ndarray:
    """AC power at the point of export, MW.

    The full chain: sun position → plane-of-array irradiance → cell temperature
    → DC power → inverter clipping → loss stack. Each step is a place a real
    plant loses energy, and the order matters — clipping before losses would
    understate the flat top.

    `weather` needs keys: ghi, dni, dhi, temp_c, wind_ms, day_of_year, hour.
    """
    assert site.solar is not None, f"{site.id} has no solar parameters"
    p = site.solar

    zenith, azimuth, _ = astronomy.solar_position(
        site.latitude, site.longitude, weather["day_of_year"], weather["hour"]
    )

    if p.tracking == "single_axis":
        tilt, surf_az = astronomy.single_axis_tracker_angles(zenith, azimuth)
    else:
        tilt, surf_az = p.tilt_deg, p.azimuth_deg

    poa = plane_of_array_irradiance(
        weather["ghi"], weather["dni"], weather["dhi"], zenith, azimuth, tilt, surf_az
    )

    t_cell = cell_temperature(poa, weather["temp_c"], weather.get("wind_ms"))

    # DC array is oversized relative to the AC rating by dc_ac_ratio.
    dc_capacity_mw = site.capacity_mw * p.dc_ac_ratio

    # Linear in irradiance, derated by temperature. Crystalline silicon loses
    # ~0.38%/°C above 25 °C.
    temp_factor = 1.0 + TEMP_COEFF_PMAX_PER_C * (t_cell - STC_CELL_TEMP_C)
    dc_mw = dc_capacity_mw * (poa / STC_IRRADIANCE) * temp_factor

    # Clipping: the inverter simply cannot pass more than its rating, so excess
    # DC is discarded. This is the flat-topped midday plateau on a clear day —
    # a real feature of an oversized array, not a bug.
    ac_mw = np.minimum(dc_mw * p.inverter_efficiency, site.capacity_mw)

    ac_mw = ac_mw * (1.0 - p.system_losses)
    return np.clip(ac_mw, 0.0, site.capacity_mw)


# ═════════════════════════════════════════════════════════════════════════
# WIND
# ═════════════════════════════════════════════════════════════════════════


def extrapolate_wind_speed(
    speed_at_ref_ms: np.ndarray,
    reference_height_m: float,
    hub_height_m: float,
    shear_exponent: float,
) -> np.ndarray:
    """Wind speed at hub height by the power law.

    Forecasts report 10 m wind; turbines hub at 80–120 m, where the air is
    substantially faster. Because power goes as the cube of speed, the
    extrapolation is the single highest-leverage step in the wind model: using
    10 m speed directly at Jaisalmer's 100 m hub understates power by roughly
    a factor of two.
    """
    return speed_at_ref_ms * np.power(hub_height_m / reference_height_m, shear_exponent)


def observed_shear_exponent(
    speed_10_ms: np.ndarray,
    speed_100_ms: np.ndarray,
    fallback: float,
) -> np.ndarray:
    """Local shear exponent measured from the two forecast heights.

    The weather feed gives wind at both 10 m and 100 m, which means the power
    law's exponent does not have to be assumed — it can be solved for:

        α = ln(v₁₀₀ / v₁₀) / ln(100 / 10)

    This matters more than it looks. Shear is not a site constant; it tracks
    atmospheric stability over the day. A stable night-time boundary layer
    decouples from the surface and shears hard, α above 0.3; a convective
    afternoon mixes and flattens it toward 0.1. At Muppandal the measured
    median is 0.21 against the 0.11 the site metadata assumes, and because
    power goes as v³ that difference alone is worth roughly 35% of output.

    Using the measurement also removes a class of error the model cannot fix:
    a fixed exponent is wrong in a *time-varying* way, so Stage B would have to
    learn a correction that changes sign twice a day.

    Clipped to [0.05, 0.40]. Outside that range the two heights disagree in a
    way that means calm-wind numerical noise, not real shear, and the cube
    amplifies it into nonsense.
    """
    v10 = np.asarray(speed_10_ms, dtype=float)
    v100 = np.asarray(speed_100_ms, dtype=float)

    with np.errstate(divide="ignore", invalid="ignore"):
        alpha = np.log(v100 / v10) / np.log(10.0)

    usable = np.isfinite(alpha) & (v10 > 0.5) & (v100 > 0.5)
    return np.where(usable, np.clip(alpha, 0.05, 0.40), fallback)


def hub_height_speed(site: Site, weather: dict[str, np.ndarray]) -> np.ndarray:
    """Hub-height wind speed, preferring the measured shear.

    Extrapolates down from 100 m rather than up from 10 m whenever the 100 m
    series is available, because every Indian hub height in this fleet
    (80–100 m) is nearer 100 m than 10 m. Interpolating a short distance from
    the closer measurement is a smaller extrapolation than projecting an order
    of magnitude up from the surface, where roughness and stability dominate.

    Falls back to the site's catalogued exponent from 10 m when the 100 m series
    is absent, so the function works against any weather source.
    """
    assert site.wind is not None, f"{site.id} has no wind parameters"
    p = site.wind
    v10 = weather["wind_ms"]
    v100 = weather.get("wind_100_ms")

    if v100 is None:
        return extrapolate_wind_speed(
            v10, WIND_MEASUREMENT_HEIGHT_M, p.hub_height_m, p.shear_exponent
        )

    alpha = observed_shear_exponent(v10, v100, p.shear_exponent)
    return np.asarray(v100, dtype=float) * np.power(p.hub_height_m / 100.0, alpha)



def air_density(
    temp_c: np.ndarray,
    elevation_m: float,
    pressure_pa: np.ndarray | None = None,
) -> np.ndarray:
    """Air density, kg/m³, from the ideal gas law.

    Turbine power curves are rated at 1.225 kg/m³. Thin air carries less
    momentum, so the same wind speed yields less power. Jaisalmer at 225 m in
    45 °C summer air is near 1.10 kg/m³ — a 10% power deficit the speed alone
    does not reveal.
    """
    if pressure_pa is None:
        # Standard atmosphere. Elevation is the dominant term; using it is far
        # better than assuming sea level.
        pressure_pa = SEA_LEVEL_PRESSURE_PA * np.power(
            1.0 - TEMPERATURE_LAPSE_RATE_K_PER_M * elevation_m / STANDARD_SEA_LEVEL_TEMP_K,
            BAROMETRIC_EXPONENT,
        )
    temp_k = temp_c + 273.15
    return pressure_pa / (SPECIFIC_GAS_CONSTANT_DRY_AIR * temp_k)


# Reference normalised turbine power curve.
#
# Rows are (wind speed ÷ rated speed, power ÷ rated power), digitised from a
# Vestas V90-2.0 MW — an IEC Class I machine representative of the fleet at
# Muppandal and Jaisalmer.
#
# ## Why a table and not v³
#
# The textbook simplification `((v − v_in) / (v_r − v_in))³` is badly wrong in
# the middle of the curve, which is where a turbine spends nearly all its
# operating hours. At 7 m/s with a 13 m/s rated speed it returns 5% of rated
# power; the real machine delivers 29%. Aggregated over a year that formula
# produced a 4.4% capacity factor at Muppandal, against the ~25% the site
# actually achieves — an error large enough to invalidate every downstream
# number.
#
# The physical reason is that the power coefficient Cp is not constant. It peaks
# near 0.47 through the mid range where the rotor runs at optimal tip-speed
# ratio, then falls away as pitch regulation begins shedding energy to hold
# rated power. So the real curve is an S: steeper than cubic below the knee,
# flatter above it. Normalising by rated speed makes one table serve all three
# IEC classes, because specific power scales with rated speed by construction —
# a low-wind Class III machine is the same aerodynamics with a bigger rotor.
_CURVE_V_OVER_RATED = np.array(
    [0.00, 0.27, 0.31, 0.38, 0.46, 0.54, 0.62, 0.69, 0.77, 0.85, 0.92, 1.00]
)
_CURVE_P_OVER_RATED = np.array(
    [0.000, 0.000, 0.038, 0.096, 0.179, 0.292, 0.438, 0.602, 0.772, 0.899, 0.963, 1.000]
)


def power_curve_fraction(speed_ms: np.ndarray, turbine_class: str) -> np.ndarray:
    """Fraction of rated power for a given hub-height wind speed.

    Interpolates the reference normalised curve above, then applies the class's
    own cut-in and cut-out as hard gates:

      below cut-in      0     — not enough torque to overcome losses
      cut-in → rated    curve — the S-shape of a real machine
      rated → cut-out   1.0   — pitch control sheds the excess
      above cut-out     0     — the turbine shuts down to protect itself

    That last cliff is real and is kept sharp deliberately. Crossing 25 m/s
    takes a farm from full output to zero, which is why a storm forecast is a
    *generation* risk rather than a bonus. Any model that smooths it away cannot
    warn an operator about the thing that most threatens the schedule.
    """
    spec = TURBINE_CLASSES.get(turbine_class, TURBINE_CLASSES["iec_ii"])
    cut_in, rated, cut_out = spec["cut_in"], spec["rated"], spec["cut_out"]

    v = np.asarray(speed_ms, dtype=float)
    fraction = np.interp(v / rated, _CURVE_V_OVER_RATED, _CURVE_P_OVER_RATED)

    return np.where(
        (v >= cut_in) & (v <= cut_out), np.where(v >= rated, 1.0, fraction), 0.0
    )


def wind_power_mw(site: Site, weather: dict[str, np.ndarray]) -> np.ndarray:
    """Farm AC power at the point of export, MW.

    `weather` needs keys: wind_ms, temp_c; optionally wind_100_ms, pressure_pa.
    """
    assert site.wind is not None, f"{site.id} has no wind parameters"
    p = site.wind

    v_hub = hub_height_speed(site, weather)

    rho = air_density(weather["temp_c"], site.elevation_m, weather.get("pressure_pa"))
    # Density enters power linearly, and power goes as v³, so an equivalent
    # speed correction is the cube root of the density ratio. Applying it to
    # speed rather than to power keeps cut-in and cut-out in the right place.
    v_corrected = v_hub * np.cbrt(rho / STANDARD_AIR_DENSITY)

    fraction = power_curve_fraction(v_corrected, p.turbine_class)

    farm_mw = site.capacity_mw * fraction * (1.0 - p.wake_loss) * p.availability
    return np.clip(farm_mw, 0.0, site.capacity_mw)


def physics_power_mw(site: Site, weather: dict[str, np.ndarray]) -> np.ndarray:
    """Dispatch to the right plant model. The only entry point callers need."""
    if site.technology == "solar":
        return solar_power_mw(site, weather)
    return wind_power_mw(site, weather)
