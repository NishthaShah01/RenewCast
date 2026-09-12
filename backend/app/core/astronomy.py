"""Solar geometry and clear-sky irradiance.

Pure functions, no I/O, no dependencies beyond the standard library and numpy.
Everything here is deterministic physics: given a location and an instant, the
sun is where it is. No model is fitted and nothing is tuned.

Why this module exists separately from `physics.py`: solar position is needed
by the feature builder (to compute a clear-sky index, which is the single most
informative solar feature) *and* by the plane-of-array transposition. Keeping
it standalone means the feature builder does not import the plant model.

Algorithm: the NOAA solar position equations, accurate to about 0.01° over the
period we care about. That is roughly two orders of magnitude finer than the
uncertainty in the weather forecast driving it, so a more elaborate ephemeris
would buy nothing.
"""

from __future__ import annotations

import numpy as np

from app.data.constants import SOLAR_CONSTANT_W_M2

# Haurwitz clear-sky coefficients. A one-term model, published 1945, still
# competitive for GHI because clear-sky GHI is dominated by air mass. We use it
# for the clear-sky *index* (measured / clear-sky), where a small systematic
# bias cancels out of the ratio.
_HAURWITZ_A = 1098.0
_HAURWITZ_B = 0.059

# Below this solar elevation the sun contributes nothing usable and the air-mass
# formula becomes numerically unstable. Treated as night.
MIN_USABLE_ELEVATION_DEG = 0.5


def _fractional_year(day_of_year: np.ndarray, hour: np.ndarray) -> np.ndarray:
    """Angular position in the orbit, radians."""
    return 2.0 * np.pi / 365.0 * (day_of_year - 1.0 + (hour - 12.0) / 24.0)


def equation_of_time_min(day_of_year: np.ndarray, hour: np.ndarray) -> np.ndarray:
    """Discrepancy between apparent solar time and mean solar time, in minutes.

    Earth's orbit is elliptical and its axis tilted, so the sun runs up to ~16
    minutes fast or slow against the clock. Ignoring this shifts the modelled
    solar noon by up to four time blocks at the extremes — visible as a forecast
    curve that peaks in the wrong block.
    """
    g = _fractional_year(day_of_year, hour)
    return 229.18 * (
        0.000075
        + 0.001868 * np.cos(g)
        - 0.032077 * np.sin(g)
        - 0.014615 * np.cos(2 * g)
        - 0.040849 * np.sin(2 * g)
    )


def declination_rad(day_of_year: np.ndarray, hour: np.ndarray) -> np.ndarray:
    """Solar declination in radians: the sun's latitude, ±23.44° over a year."""
    g = _fractional_year(day_of_year, hour)
    return (
        0.006918
        - 0.399912 * np.cos(g)
        + 0.070257 * np.sin(g)
        - 0.006758 * np.cos(2 * g)
        + 0.000907 * np.sin(2 * g)
        - 0.002697 * np.cos(3 * g)
        + 0.001480 * np.sin(3 * g)
    )


def solar_position(
    latitude: float,
    longitude: float,
    day_of_year: np.ndarray,
    hour_of_day: np.ndarray,
    utc_offset_hours: float = 5.5,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Sun position for an array of instants.

    `hour_of_day` is local (IST) decimal hours — 10.5 means 10:30 IST. The
    `utc_offset_hours` default of 5.5 is IST; it is a parameter rather than a
    constant only so the functions stay testable against published values for
    other longitudes.

    Returns `(zenith_deg, azimuth_deg, elevation_deg)` where azimuth is measured
    clockwise from true north, the convention module azimuth uses (180° = due
    south), so the two can be differenced directly.
    """
    lat = np.radians(latitude)
    decl = declination_rad(day_of_year, hour_of_day)
    eot = equation_of_time_min(day_of_year, hour_of_day)

    # True solar time: correct the clock for the site's offset from its
    # timezone meridian (4 minutes per degree) and for the equation of time.
    # India runs one timezone across 28° of longitude, so this term is large:
    # Jaisalmer's solar noon is nearly 40 minutes after Kolkata's.
    time_offset_min = eot + 4.0 * longitude - 60.0 * utc_offset_hours
    true_solar_time_min = hour_of_day * 60.0 + time_offset_min

    # Hour angle: 0° at solar noon, -180°..180°, 15° per hour.
    hour_angle = np.radians(true_solar_time_min / 4.0 - 180.0)

    cos_zenith = np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(hour_angle)
    cos_zenith = np.clip(cos_zenith, -1.0, 1.0)
    zenith = np.degrees(np.arccos(cos_zenith))

    # atan2 form rather than arccos: it is stable near the poles of the
    # expression and resolves the east/west ambiguity without a sign test.
    azimuth_from_south = np.arctan2(
        np.sin(hour_angle),
        np.cos(hour_angle) * np.sin(lat) - np.tan(decl) * np.cos(lat),
    )
    azimuth = (np.degrees(azimuth_from_south) + 180.0) % 360.0

    return zenith, azimuth, 90.0 - zenith


def air_mass(zenith_deg: np.ndarray) -> np.ndarray:
    """Relative optical air mass (Kasten & Young 1989).

    1.0 with the sun overhead, ~38 at the horizon. Returns `inf` below the
    horizon so downstream exponentials drive irradiance to zero rather than
    producing a negative path length.
    """
    z = np.minimum(zenith_deg, 90.0)
    denom = np.cos(np.radians(z)) + 0.50572 * np.power(96.07995 - z, -1.6364)
    return np.where(zenith_deg < 90.0, 1.0 / np.maximum(denom, 1e-6), np.inf)


def extraterrestrial_irradiance(day_of_year: np.ndarray) -> np.ndarray:
    """Solar irradiance above the atmosphere, W/m².

    Varies ±3.3% across the year because Earth's orbit is elliptical — perihelion
    is in early January, so Indian winter sunlight is marginally more intense
    before the atmosphere gets to it.
    """
    return SOLAR_CONSTANT_W_M2 * (1.0 + 0.033 * np.cos(2.0 * np.pi * day_of_year / 365.0))


def clear_sky_ghi(zenith_deg: np.ndarray) -> np.ndarray:
    """Haurwitz clear-sky global horizontal irradiance, W/m².

    The denominator of the clear-sky index. That index — actual GHI over
    clear-sky GHI — is what separates "low output because it is 6am" from "low
    output because it is cloudy", and the two have completely different
    forecast uncertainty. A model given raw GHI has to learn the solar geometry
    from scratch; a model given the clear-sky index starts with it.
    """
    cos_z = np.cos(np.radians(np.minimum(zenith_deg, 90.0)))
    cos_z = np.maximum(cos_z, 1e-6)
    ghi = _HAURWITZ_A * cos_z * np.exp(-_HAURWITZ_B / cos_z)
    return np.where(zenith_deg < 90.0, np.maximum(ghi, 0.0), 0.0)


def clear_sky_index(ghi: np.ndarray, zenith_deg: np.ndarray) -> np.ndarray:
    """Measured GHI as a fraction of clear-sky GHI, clipped to [0, 1.2].

    The cap above 1.0 is deliberate, not a guard against bad data: cloud-edge
    reflection genuinely pushes brief GHI above the clear-sky value. Clipping to
    1.0 would erase a real physical signal that precedes a ramp.
    """
    cs = clear_sky_ghi(zenith_deg)
    idx = np.divide(ghi, cs, out=np.zeros_like(ghi, dtype=float), where=cs > 1.0)
    return np.clip(idx, 0.0, 1.2)


def is_daylight(zenith_deg: np.ndarray) -> np.ndarray:
    """Boolean mask for blocks the sun is usefully above the horizon."""
    return (90.0 - zenith_deg) > MIN_USABLE_ELEVATION_DEG


def angle_of_incidence(
    zenith_deg: np.ndarray,
    azimuth_deg: np.ndarray,
    surface_tilt_deg: np.ndarray | float,
    surface_azimuth_deg: np.ndarray | float,
) -> np.ndarray:
    """Angle between the sun and the module normal, degrees.

    The controlling quantity for direct irradiance: a beam striking at 60° off
    normal delivers half the power of one striking square on, whatever the
    irradiance reading says.
    """
    z = np.radians(zenith_deg)
    tilt = np.radians(surface_tilt_deg)
    delta_az = np.radians(azimuth_deg - surface_azimuth_deg)
    cos_aoi = np.cos(z) * np.cos(tilt) + np.sin(z) * np.sin(tilt) * np.cos(delta_az)
    return np.degrees(np.arccos(np.clip(cos_aoi, -1.0, 1.0)))


def single_axis_tracker_angles(
    zenith_deg: np.ndarray,
    azimuth_deg: np.ndarray,
    axis_azimuth_deg: float = 180.0,
    max_rotation_deg: float = 60.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Surface tilt and azimuth for a horizontal north-south tracking axis.

    Modules rotate east to west through the day, which is why Pavagada's curve
    is a broad plateau while fixed-tilt Bhadla's is a narrower peak. Modelling
    tracking as a fixed tilt would misplace hundreds of MW in the morning and
    evening shoulders — exactly the blocks where schedule revision decisions
    get made.

    Rotation is clamped to `max_rotation_deg`, the mechanical stop on real
    trackers. Backtracking (rotating back at low sun to avoid row-to-row
    shading) is not modelled; it is a second-order effect on total energy and
    would need row pitch we do not have.
    """
    z = np.radians(zenith_deg)
    delta_az = np.radians(azimuth_deg - axis_azimuth_deg)

    # Ideal rotation puts the axis-perpendicular component of the sun vector
    # in the module plane.
    rotation = np.degrees(np.arctan2(np.sin(z) * np.sin(delta_az), np.cos(z)))
    rotation = np.clip(rotation, -max_rotation_deg, max_rotation_deg)

    surface_tilt = np.abs(rotation)
    # Positive rotation faces west of the axis, negative faces east.
    surface_azimuth = np.where(
        rotation >= 0.0,
        (axis_azimuth_deg + 90.0) % 360.0,
        (axis_azimuth_deg - 90.0) % 360.0,
    )
    return surface_tilt, surface_azimuth.astype(float)
