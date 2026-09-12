"""The site registry.

Five real Indian renewable installations. Coordinates and nameplate capacity
are public record; everything else — evacuation limit, plant-level losses,
battery sizing, tariff — is an ENGINEERING ASSUMPTION chosen to be plausible
for a plant of that type and size.

The distinction matters and is carried through to the UI: fields marked
`assumed=True` in the API response render with an "Indicative — configurable"
badge, and the site-configuration form lets an operator replace them with
their own numbers. Nothing here is presented as authoritative.

Four of the five sit in Gujarat, Rajasthan and Tamil Nadu, which have all
recorded renewable output exceeding local demand. That is not a coincidence in
the fixture data: curtailment is a first-class action in this product, and it
needs sites where curtailment actually happens.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.data.constants import (
    DEFAULT_TURBINE_CLASS,
    SOLAR_PPA_TARIFF,
    WIND_PPA_TARIFF,
    WIND_SHEAR_EXPONENT_DEFAULT,
)

Technology = Literal["solar", "wind"]
Tracking = Literal["fixed", "single_axis"]


class SolarParams(BaseModel):
    """Plant geometry and loss stack for a PV site."""

    tilt_deg: float = Field(ge=0, le=90)
    """Module tilt from horizontal. Fixed-tilt plants are usually set near the
    site latitude to maximise annual yield."""

    azimuth_deg: float = Field(default=180.0, ge=0, lt=360)
    """Compass bearing the modules face. 180° is due south — correct for the
    whole northern hemisphere."""

    tracking: Tracking = "fixed"
    """Single-axis tracking broadens the generation shoulder, which changes the
    shape of the curve, not just its height."""

    dc_ac_ratio: float = Field(default=1.25, gt=0)
    """DC array capacity over AC inverter capacity. Above 1.0 the inverter
    clips the midday peak — the flat top on a clear-sky summer profile is this,
    not a modelling error."""

    system_losses: float = Field(default=0.14, ge=0, lt=1)
    """Combined soiling, wiring, mismatch, and availability losses. Indian
    desert sites soil heavily between monsoons, so 14 % is on the honest side
    of typical."""

    inverter_efficiency: float = Field(default=0.98, gt=0, le=1)


class WindParams(BaseModel):
    """Turbine fleet parameters for a wind site."""

    hub_height_m: float = Field(gt=0)
    """Wind speed is extrapolated from the forecast measurement height to this
    height by the power law. Getting it wrong scales the entire curve."""

    rotor_diameter_m: float = Field(gt=0)

    turbine_class: str = DEFAULT_TURBINE_CLASS
    """IEC class, which fixes cut-in, rated and cut-out speeds."""

    n_turbines: int = Field(gt=0)

    shear_exponent: float = Field(default=WIND_SHEAR_EXPONENT_DEFAULT, ge=0, le=1)
    """Terrain roughness. 0.143 is open flat ground; hills and forest are
    higher. Muppandal's gap-wind regime is closer to open coast."""

    wake_loss: float = Field(default=0.08, ge=0, lt=1)
    """Turbines downwind of others see slowed, more turbulent air. Dense older
    layouts lose more."""

    availability: float = Field(default=0.97, gt=0, le=1)


class BatterySpec(BaseModel):
    """Optional co-located storage. `None` capacity means no battery."""

    power_mw: float = Field(ge=0)
    energy_mwh: float = Field(ge=0)
    initial_soc: float = Field(default=0.5, ge=0, le=1)


class Site(BaseModel):
    """One generating station.

    Serialised directly as the API response — there is no separate DTO, because
    a second shape would be a second thing to keep in sync for no benefit.
    """

    id: str
    name: str
    state: str
    technology: Technology

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    elevation_m: float
    """Feeds the air-density correction for wind and the clear-sky model for
    solar. Jaisalmer at 225 m and Pavagada at 650 m are meaningfully different
    air."""

    capacity_mw: float = Field(gt=0)
    """Nameplate AC capacity. Public record."""

    evacuation_limit_mw: float = Field(gt=0)
    """ASSUMED. The transmission capacity available to move power off site.
    Below nameplate at every large park, which is exactly why forecast surplus
    turns into curtailment rather than revenue."""

    commissioned_year: int

    tariff_per_mwh: float = Field(gt=0)
    """ASSUMED, indicative. Used to price curtailed energy as revenue forgone."""

    solar: SolarParams | None = None
    wind: WindParams | None = None
    battery: BatterySpec | None = None

    @property
    def has_storage(self) -> bool:
        return self.battery is not None and self.battery.energy_mwh > 0

    @property
    def headroom_mw(self) -> float:
        """Capacity that physically cannot reach the grid. A positive number
        here means curtailment is structural, not incidental."""
        return max(0.0, self.capacity_mw - self.evacuation_limit_mw)


# ═════════════════════════════════════════════════════════════════════════
# THE REGISTRY
# ═════════════════════════════════════════════════════════════════════════

SITES: list[Site] = [
    Site(
        id="bhadla",
        name="Bhadla Solar Park",
        state="Rajasthan",
        technology="solar",
        latitude=27.54,
        longitude=71.92,
        elevation_m=220.0,
        capacity_mw=2245.0,
        evacuation_limit_mw=2000.0,
        commissioned_year=2020,
        tariff_per_mwh=SOLAR_PPA_TARIFF,
        solar=SolarParams(
            # Near-latitude tilt, the standard fixed-tilt choice.
            tilt_deg=25.0,
            azimuth_deg=180.0,
            tracking="fixed",
            dc_ac_ratio=1.30,
            # Thar desert dust: soiling here is the dominant loss term.
            system_losses=0.16,
        ),
        battery=BatterySpec(power_mw=100.0, energy_mwh=400.0),
    ),
    Site(
        id="pavagada",
        name="Pavagada Solar Park (Shakti Sthala)",
        state="Karnataka",
        technology="solar",
        latitude=14.10,
        longitude=77.28,
        elevation_m=650.0,
        capacity_mw=2050.0,
        evacuation_limit_mw=1900.0,
        commissioned_year=2019,
        tariff_per_mwh=SOLAR_PPA_TARIFF,
        solar=SolarParams(
            tilt_deg=15.0,
            azimuth_deg=180.0,
            # Later-generation park; trackers widen the morning and evening
            # shoulders, which shows up as a flatter, longer curve.
            tracking="single_axis",
            dc_ac_ratio=1.25,
            system_losses=0.13,
        ),
        battery=BatterySpec(power_mw=50.0, energy_mwh=200.0),
    ),
    Site(
        id="charanka",
        name="Charanka Solar Park",
        state="Gujarat",
        technology="solar",
        latitude=23.90,
        longitude=71.20,
        elevation_m=90.0,
        capacity_mw=790.0,
        evacuation_limit_mw=750.0,
        commissioned_year=2012,
        tariff_per_mwh=SOLAR_PPA_TARIFF,
        solar=SolarParams(
            tilt_deg=24.0,
            azimuth_deg=180.0,
            tracking="fixed",
            # India's first large park. Older modules, lower stacking ratio,
            # and a decade of degradation in the loss term.
            dc_ac_ratio=1.15,
            system_losses=0.17,
        ),
        battery=None,
    ),
    Site(
        id="muppandal",
        name="Muppandal Wind Farm",
        state="Tamil Nadu",
        technology="wind",
        latitude=8.26,
        longitude=77.55,
        elevation_m=60.0,
        capacity_mw=1500.0,
        evacuation_limit_mw=1300.0,
        commissioned_year=2010,
        tariff_per_mwh=WIND_PPA_TARIFF,
        wind=WindParams(
            # Aralvaimozhi gap winds: a monsoon-season regime so strong and so
            # concentrated that Tamil Nadu curtails wind rather than absorb it.
            hub_height_m=80.0,
            rotor_diameter_m=82.0,
            turbine_class="iec_i",
            n_turbines=1200,
            # Open coastal plain — less shear than inland terrain.
            shear_exponent=0.11,
            # Dense legacy layout, so wakes cost more than at a modern farm.
            wake_loss=0.12,
            availability=0.95,
        ),
        battery=None,
    ),
    Site(
        id="jaisalmer",
        name="Jaisalmer Wind Park",
        state="Rajasthan",
        technology="wind",
        latitude=26.91,
        longitude=70.92,
        elevation_m=225.0,
        capacity_mw=1064.0,
        evacuation_limit_mw=1000.0,
        commissioned_year=2012,
        tariff_per_mwh=WIND_PPA_TARIFF,
        wind=WindParams(
            hub_height_m=100.0,
            rotor_diameter_m=97.0,
            turbine_class="iec_ii",
            n_turbines=500,
            shear_exponent=0.14,
            wake_loss=0.09,
            availability=0.97,
        ),
        battery=BatterySpec(power_mw=60.0, energy_mwh=240.0),
    ),
]

SITES_BY_ID: dict[str, Site] = {s.id: s for s in SITES}


def get_site(site_id: str) -> Site:
    """Look up a site, raising a message a caller can show a user verbatim."""
    try:
        return SITES_BY_ID[site_id]
    except KeyError:
        known = ", ".join(SITES_BY_ID)
        raise KeyError(f"Unknown site '{site_id}'. Known sites: {known}") from None


def list_sites(technology: Technology | None = None) -> list[Site]:
    if technology is None:
        return list(SITES)
    return [s for s in SITES if s.technology == technology]
