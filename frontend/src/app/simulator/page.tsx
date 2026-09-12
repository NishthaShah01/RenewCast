"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import type {
  SimulatorDefaultsResponse,
  SimulatorRequest,
  SimulatorResponse,
  SimulatorTimelineBlock,
  Site,
} from "@/lib/types";

export default function SimulatorPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("bhadla");
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Progressive disclosure toggles
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showFullActions, setShowFullActions] = useState<boolean>(false);
  const [showFullAttribution, setShowFullAttribution] = useState<boolean>(false);

  // Authoritative baseline defaults from backend
  const [baselineDefaults, setBaselineDefaults] = useState<Record<string, number>>({});

  // Core scenario levers
  const [batteryPowerMw, setBatteryPowerMw] = useState<number>(100);
  const [batteryEnergyMwh, setBatteryEnergyMwh] = useState<number>(400);
  const [batteryInitialSocPct, setBatteryInitialSocPct] = useState<number>(50);
  const [flexibleDemandMw, setFlexibleDemandMw] = useState<number>(0);
  const [backupCapacityMw, setBackupCapacityMw] = useState<number>(449);

  // Advanced assumptions (under progressive disclosure)
  const [batteryRtePct, setBatteryRtePct] = useState<number>(88);
  const [backupNoticeHours, setBackupNoticeHours] = useState<number>(0);
  const [evacuationLimitMw, setEvacuationLimitMw] = useState<number>(2000);
  const [tariffPerMwh, setTariffPerMwh] = useState<number>(2500);
  const [gasPeakerCostPerMwh, setGasPeakerCostPerMwh] = useState<number>(8000);
  const [dieselCostPerMwh, setDieselCostPerMwh] = useState<number>(22000);

  // Simulation response state
  const [simResult, setSimResult] = useState<SimulatorResponse | null>(null);

  // Load available sites
  useEffect(() => {
    let mounted = true;
    api
      .sites()
      .then((res) => {
        if (mounted && res.sites.length > 0) {
          setSites(res.sites);
        }
      })
      .catch((err) => {
        if (mounted) setErrorMsg(err.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch baseline defaults whenever selected site changes
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingInitial(true);
    api
      .simulateDefaults(selectedSiteId)
      .then((defRes: SimulatorDefaultsResponse) => {
        if (!active) return;
        const d = defRes.defaults;
        setBaselineDefaults(d);
        // Initialize scenario controls to match baseline
        setBatteryPowerMw(d.battery_power_mw ?? 0);
        setBatteryEnergyMwh(d.battery_energy_mwh ?? 0);
        setBatteryInitialSocPct(d.battery_initial_soc_pct ?? 50);
        setFlexibleDemandMw(d.flexible_demand_mw ?? 0);
        setBackupCapacityMw(d.backup_capacity_mw ?? 0);
        setBatteryRtePct(d.battery_rte_pct ?? 88);
        setBackupNoticeHours(d.backup_notice_hours ?? 0);
        setEvacuationLimitMw(d.evacuation_limit_mw ?? 2000);
        setTariffPerMwh(d.tariff_per_mwh ?? 2500);
        setGasPeakerCostPerMwh(d.gas_peaker_cost_per_mwh ?? 8000);
        setDieselCostPerMwh(d.diesel_cost_per_mwh ?? 22000);
        setLoadingInitial(false);
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err.message);
          setLoadingInitial(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedSiteId]);

  const currentSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) ?? sites[0],
    [sites, selectedSiteId],
  );

  const capacity = currentSite?.capacity_mw ?? 2000;

  // Validation warning
  const validationWarning = useMemo(() => {
    if (batteryPowerMw > 0 && batteryEnergyMwh <= 0) {
      return {
        change: `Battery power is set to ${batteryPowerMw} MW with 0 MWh storage capacity.`,
        fix: "Increase battery energy (MWh) to enable battery dispatch.",
      };
    }
    return null;
  }, [batteryPowerMw, batteryEnergyMwh]);

  // Debounced run simulation whenever controls change
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      setIsUpdating(true);
      const payload: SimulatorRequest = {
        site_id: selectedSiteId,
        battery_power_mw: batteryPowerMw,
        battery_energy_mwh: batteryEnergyMwh,
        battery_initial_soc_pct: batteryInitialSocPct,
        battery_rte_pct: batteryRtePct,
        flexible_demand_mw: flexibleDemandMw,
        backup_capacity_mw: backupCapacityMw,
        backup_notice_hours: backupNoticeHours,
        evacuation_limit_mw: evacuationLimitMw,
        tariff_per_mwh: tariffPerMwh,
        gas_peaker_cost_per_mwh: gasPeakerCostPerMwh,
        diesel_cost_per_mwh: dieselCostPerMwh,
      };

      api
        .simulate(payload)
        .then((res) => {
          setSimResult(res);
          setErrorMsg(null);
          setIsUpdating(false);
        })
        .catch((err) => {
          setErrorMsg(err.message);
          setIsUpdating(false);
        });
    }, 200);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [
    selectedSiteId,
    batteryPowerMw,
    batteryEnergyMwh,
    batteryInitialSocPct,
    batteryRtePct,
    flexibleDemandMw,
    backupCapacityMw,
    backupNoticeHours,
    evacuationLimitMw,
    tariffPerMwh,
    gasPeakerCostPerMwh,
    dieselCostPerMwh,
    loadingInitial,
  ]);

  // Reset to authoritative baseline defaults
  const handleReset = () => {
    if (!baselineDefaults || Object.keys(baselineDefaults).length === 0) return;
    setBatteryPowerMw(baselineDefaults.battery_power_mw ?? 0);
    setBatteryEnergyMwh(baselineDefaults.battery_energy_mwh ?? 0);
    setBatteryInitialSocPct(baselineDefaults.battery_initial_soc_pct ?? 50);
    setFlexibleDemandMw(baselineDefaults.flexible_demand_mw ?? 0);
    setBackupCapacityMw(baselineDefaults.backup_capacity_mw ?? 0);
    setBatteryRtePct(baselineDefaults.battery_rte_pct ?? 88);
    setBackupNoticeHours(baselineDefaults.backup_notice_hours ?? 0);
    setEvacuationLimitMw(baselineDefaults.evacuation_limit_mw ?? 2000);
    setTariffPerMwh(baselineDefaults.tariff_per_mwh ?? 2500);
    setGasPeakerCostPerMwh(baselineDefaults.gas_peaker_cost_per_mwh ?? 8000);
    setDieselCostPerMwh(baselineDefaults.diesel_cost_per_mwh ?? 22000);
  };

  // Primary scenario outcome headline & supporting line (Strict priority order)
  const primaryOutcome = useMemo(() => {
    if (!simResult) {
      return {
        headline: "Calculating scenario outcome…",
        subline: "",
      };
    }

    const baseUnserved = simResult.baseline.unserved_energy_mwh;
    const scenUnserved = simResult.scenario.unserved_energy_mwh;
    const unservedDelta = simResult.deltas.unserved_energy_mwh; // scen - base

    let headline = "";

    // Priority A: All unserved energy removed
    if (baseUnserved > 0.05 && scenUnserved <= 0.05) {
      headline = "Scenario removes the forecast shortfall.";
    }
    // Priority B: Unserved energy reduced
    else if (unservedDelta <= -0.05) {
      const reduced = Math.abs(unservedDelta).toFixed(1);
      headline = `Scenario removes ${reduced} MWh of unserved energy.`;
    }
    // Priority C: Unserved does not improve
    else if (baseUnserved > 0.05 && scenUnserved >= baseUnserved - 0.05) {
      headline = "Scenario does not remove the remaining shortfall.";
    }
    // Baseline zero deficit already
    else if (baseUnserved <= 0.05 && scenUnserved <= 0.05) {
      headline = "Zero shortfall maintained across all 96 dispatch blocks.";
    } else {
      headline = simResult.primary_message || "Scenario plan updated.";
    }

    const baseCostStr = formatInr(simResult.baseline.net_cost_inr);
    const scenCostStr = formatInr(simResult.scenario.net_cost_inr);
    const baseCo2Str = `${simResult.baseline.net_co2_tonnes.toFixed(1)} t`;
    const scenCo2Str = `${simResult.scenario.net_co2_tonnes.toFixed(1)} t`;

    const subline = `Operating cost: ${baseCostStr} → ${scenCostStr} · Net CO₂: ${baseCo2Str} → ${scenCo2Str}`;

    return { headline, subline };
  }, [simResult]);

  // Break-even battery calculations
  const minPower = simResult?.break_even.minimum_power_mw ?? 0;
  const minEnergy = simResult?.break_even.minimum_energy_mwh ?? 0;
  const hasDeficit = minPower > 0 || minEnergy > 0;
  const meetsBreakEven = batteryPowerMw >= minPower && batteryEnergyMwh >= minEnergy;

  // 5-lever compact attribution summary
  const attributionSummary = useMemo(() => {
    const standardLevers = [
      { key: "battery", label: "Battery" },
      { key: "demand", label: "Demand" },
      { key: "grid", label: "Grid" },
      { key: "backup", label: "Backup" },
      { key: "econom", label: "Economics" },
    ];

    if (!simResult?.attribution) {
      return standardLevers.map((lev) => ({
        label: lev.label,
        deltaText: "₹0",
        colorClass: "text-ink-muted",
      }));
    }

    return standardLevers.map((lev) => {
      const match = simResult.attribution.find((a) =>
        a.lever.toLowerCase().includes(lev.key),
      );
      if (!match) {
        return {
          label: lev.label,
          deltaText: "₹0",
          colorClass: "text-ink-muted",
        };
      }

      const cost = match.cost_delta_inr;
      const unserved = match.unserved_delta_mwh;
      const hasCost = Math.abs(cost) >= 10;
      const hasUnserved = Math.abs(unserved) >= 0.05;

      let deltaText = "₹0";
      let colorClass = "text-ink-secondary";

      if (hasCost) {
        deltaText = formatInrDelta(cost);
        colorClass = cost < 0 ? "text-[var(--delta-pos)]" : "text-[var(--delta-neg)]";
      } else if (hasUnserved) {
        deltaText = `${unserved > 0 ? "+" : "−"}${Math.abs(unserved).toFixed(1)} MWh`;
        colorClass = unserved < 0 ? "text-[var(--delta-pos)]" : "text-[var(--delta-neg)]";
      }

      return {
        label: lev.label,
        deltaText,
        colorClass,
      };
    });
  }, [simResult]);

  return (
    <main className="mx-auto w-full max-w-[1360px] px-4 sm:px-6 py-6 flex flex-col gap-6">
      {/* ── 1. Top Section ────────────────────────────────────────── */}
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--gridline)] pb-4">
        <div>
          <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">
            What-if simulator
          </h1>
          <p className="mt-0.5 text-12 text-ink-secondary">
            Change an operating assumption and see how the plan changes.
          </p>
        </div>

        {/* Site Selector & Reset */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="simulator-site-select" className="text-11 text-ink-muted font-medium">
              Site:
            </label>
            <select
              id="simulator-site-select"
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="rounded-control border border-[var(--ring)] bg-surface px-2.5 py-1 text-12 font-medium text-ink-primary cursor-pointer focus:outline-none focus:border-ink-primary"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.capacity_mw.toLocaleString("en-IN")} MW {s.technology})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-control border border-[var(--ring)] bg-surface px-2.5 py-1 text-12 text-ink-secondary hover:text-ink-primary hover:bg-[var(--page)] transition-colors cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
        </div>
      </header>

      {/* ── 2. Unified Analytical Workspace Container ────────────── */}
      <div className="rounded-panel border border-[var(--ring)] bg-surface divide-y divide-[var(--gridline)] overflow-hidden">
        {/* Error notification if any */}
        {errorMsg && (
          <div className="border-b border-[var(--delta-neg)]/30 bg-[var(--delta-neg)]/8 px-4 py-2 text-12 text-[var(--delta-neg)]">
            {errorMsg}
          </div>
        )}

        {/* ── UPPER MAIN GRID: Desktop 2-Column (~340px Left / Remainder Right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--gridline)] items-stretch">
          {/* ── LEFT COLUMN: Scenario Controls ─────────────────────── */}
          <div className="flex flex-col bg-surface">
            {/* Column Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gridline)]">
              <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
                Scenario controls
              </span>
              {isUpdating && (
                <span className="text-10 text-ink-muted animate-pulse">Calculating…</span>
              )}
            </div>

            {/* Validation warning banner */}
            {validationWarning && (
              <div className="m-3 rounded-control border border-[var(--delta-neg)]/30 bg-[var(--delta-neg)]/5 p-2.5 flex flex-col gap-0.5 text-11">
                <span className="font-semibold text-[var(--delta-neg)]">
                  {validationWarning.change}
                </span>
                <span className="text-ink-secondary">{validationWarning.fix}</span>
              </div>
            )}

            {/* Grouped control sections separated by hairlines */}
            <div className="divide-y divide-[var(--gridline)]">
              {/* BATTERY STORAGE LEVERS */}
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-12 font-medium text-ink-primary">Battery storage</span>
                  <span className="text-10 text-ink-muted tabular-nums">
                    Base: {baselineDefaults.battery_power_mw ?? 0} MW · {baselineDefaults.battery_energy_mwh ?? 0} MWh
                  </span>
                </div>

                <SliderInput
                  label="Battery power"
                  unit="MW"
                  min={0}
                  max={Math.round(capacity * 0.8)}
                  step={10}
                  value={batteryPowerMw}
                  onChange={setBatteryPowerMw}
                />

                <SliderInput
                  label="Battery energy"
                  unit="MWh"
                  min={0}
                  max={Math.round(capacity * 2.5)}
                  step={20}
                  value={batteryEnergyMwh}
                  onChange={setBatteryEnergyMwh}
                />

                <SliderInput
                  label="Initial SoC"
                  unit="%"
                  min={0}
                  max={100}
                  step={5}
                  value={batteryInitialSocPct}
                  onChange={setBatteryInitialSocPct}
                />
              </div>

              {/* DEMAND FLEXIBILITY */}
              <div className="p-4 flex flex-col gap-3">
                <span className="text-12 font-medium text-ink-primary">Flexible demand</span>
                <SliderInput
                  label="Demand shift"
                  unit="MW"
                  min={0}
                  max={Math.round(capacity * 0.25)}
                  step={5}
                  value={flexibleDemandMw}
                  onChange={setFlexibleDemandMw}
                />
              </div>

              {/* BACKUP AVAILABILITY */}
              <div className="p-4 flex flex-col gap-3">
                <span className="text-12 font-medium text-ink-primary">Backup availability</span>
                <SliderInput
                  label="Thermal backup"
                  unit="MW"
                  min={0}
                  max={Math.round(capacity * 0.5)}
                  step={10}
                  value={backupCapacityMw}
                  onChange={setBackupCapacityMw}
                />
              </div>

              {/* ADVANCED ASSUMPTIONS (COLLAPSED BY DEFAULT) */}
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-left text-11 font-medium text-ink-muted hover:text-ink-primary transition-colors cursor-pointer"
                >
                  <span>Advanced assumptions</span>
                  <span>{showAdvanced ? "▴" : "▾"}</span>
                </button>

                {showAdvanced && (
                  <div className="mt-3 pt-3 border-t border-[var(--gridline)]/80 flex flex-col gap-3 text-11">
                    <NumberInput
                      label="Round-trip efficiency"
                      unit="%"
                      min={60}
                      max={98}
                      step={1}
                      value={batteryRtePct}
                      onChange={setBatteryRtePct}
                    />

                    <div className="flex flex-col gap-1">
                      <label htmlFor="ctl-notice" className="text-ink-muted">
                        Backup notice
                      </label>
                      <select
                        id="ctl-notice"
                        value={backupNoticeHours}
                        onChange={(e) => setBackupNoticeHours(Number(e.target.value))}
                        className="rounded-control border border-[var(--ring)] bg-surface px-2 py-1 text-11 text-ink-primary cursor-pointer focus:outline-none focus:border-ink-primary"
                      >
                        <option value={0}>0 hours (instantaneous dispatch)</option>
                        <option value={1}>1 hour (4 time blocks)</option>
                        <option value={1.5}>1.5 hours (revision horizon)</option>
                        <option value={2}>2 hours (8 time blocks)</option>
                        <option value={4}>4 hours (16 time blocks)</option>
                      </select>
                    </div>

                    <NumberInput
                      label="Grid export limit"
                      unit="MW"
                      min={Math.round(capacity * 0.3)}
                      max={Math.round(capacity * 1.2)}
                      step={25}
                      value={evacuationLimitMw}
                      onChange={setEvacuationLimitMw}
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <NumberInput
                        label="PPA tariff"
                        unit="₹/MWh"
                        min={0}
                        max={10000}
                        step={100}
                        value={tariffPerMwh}
                        onChange={setTariffPerMwh}
                      />
                      <NumberInput
                        label="Gas peaker cost"
                        unit="₹/MWh"
                        min={0}
                        max={30000}
                        step={500}
                        value={gasPeakerCostPerMwh}
                        onChange={setGasPeakerCostPerMwh}
                      />
                    </div>

                    <NumberInput
                      label="Diesel cost"
                      unit="₹/MWh"
                      min={0}
                      max={50000}
                      step={1000}
                      value={dieselCostPerMwh}
                      onChange={setDieselCostPerMwh}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Scenario Result & 96-Block Graph ─────── */}
          <div className="flex flex-col p-4 sm:p-5 gap-4">
            {/* Main Result Statement */}
            <div className="flex flex-col gap-1 pb-3 border-b border-[var(--gridline)]">
              <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
                Scenario result
              </span>
              <div className="text-18 sm:text-20 font-semibold text-ink-primary tracking-[-0.01em]">
                {primaryOutcome.headline}
              </div>
              {primaryOutcome.subline && (
                <div className="text-12 text-ink-secondary tabular-nums">
                  {primaryOutcome.subline}
                </div>
              )}
            </div>

            {/* Current vs Scenario 96-Block Dispatch Timeline Graph */}
            <div className="flex-1 flex flex-col justify-center">
              <SimulatorTimelineChart
                timeline={simResult?.timeline ?? []}
                capacityMw={capacity}
              />
            </div>
          </div>
        </div>

        {/* ── LOWER SECTION 1: Baseline → Scenario impact ──────────── */}
        <section className="p-4 sm:p-5 flex flex-col gap-3.5">
          <div className="flex items-baseline justify-between border-b border-[var(--gridline)] pb-2">
            <div>
              <h2 className="text-12 font-semibold uppercase tracking-wider text-ink-muted">
                Baseline → Scenario impact
              </h2>
            </div>
            <span className="text-11 text-ink-muted">24-hour dispatch day (96 blocks)</span>
          </div>

          {/* Structured comparison table with aligned columns */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-12">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-11 text-ink-muted uppercase tracking-wider">
                  <th scope="col" className="py-2 pr-4 text-left font-medium">
                    Metric
                  </th>
                  <th scope="col" className="py-2 px-4 text-right font-medium">
                    Baseline
                  </th>
                  <th scope="col" className="py-2 px-4 text-right font-medium">
                    Scenario
                  </th>
                  <th scope="col" className="py-2 pl-4 text-right font-semibold text-ink-primary">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gridline)] tabular-nums">
                {/* Unserved */}
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-ink-primary">Unserved energy</td>
                  <td className="py-2.5 px-4 text-right text-ink-secondary">
                    {(simResult?.baseline.unserved_energy_mwh ?? 0).toFixed(1)} MWh
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium text-ink-primary">
                    {(simResult?.scenario.unserved_energy_mwh ?? 0).toFixed(1)} MWh
                  </td>
                  <td className="py-2.5 pl-4 text-right text-13 font-bold">
                    <DeltaValue
                      val={simResult?.deltas.unserved_energy_mwh ?? 0}
                      unit="MWh"
                      isLowerBetter={true}
                    />
                  </td>
                </tr>

                {/* Curtailment */}
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-ink-primary">Curtailed energy</td>
                  <td className="py-2.5 px-4 text-right text-ink-secondary">
                    {(simResult?.baseline.curtailed_energy_mwh ?? 0).toFixed(1)} MWh
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium text-ink-primary">
                    {(simResult?.scenario.curtailed_energy_mwh ?? 0).toFixed(1)} MWh
                  </td>
                  <td className="py-2.5 pl-4 text-right text-13 font-bold">
                    <DeltaValue
                      val={simResult?.deltas.curtailed_energy_mwh ?? 0}
                      unit="MWh"
                      isLowerBetter={true}
                    />
                  </td>
                </tr>

                {/* Cost */}
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-ink-primary">Operating cost</td>
                  <td className="py-2.5 px-4 text-right text-ink-secondary">
                    {formatInr(simResult?.baseline.net_cost_inr ?? 0)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium text-ink-primary">
                    {formatInr(simResult?.scenario.net_cost_inr ?? 0)}
                  </td>
                  <td className="py-2.5 pl-4 text-right text-13 font-bold">
                    <DeltaValue
                      val={simResult?.deltas.net_cost_inr ?? 0}
                      isCurrency={true}
                      isLowerBetter={true}
                    />
                  </td>
                </tr>

                {/* CO2 */}
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-ink-primary">CO₂ emissions</td>
                  <td className="py-2.5 px-4 text-right text-ink-secondary">
                    {(simResult?.baseline.net_co2_tonnes ?? 0).toFixed(1)} t
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium text-ink-primary">
                    {(simResult?.scenario.net_co2_tonnes ?? 0).toFixed(1)} t
                  </td>
                  <td className="py-2.5 pl-4 text-right text-13 font-bold">
                    <DeltaValue
                      val={simResult?.deltas.net_co2_tonnes ?? 0}
                      unit="t"
                      isLowerBetter={true}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Visual Shift bars */}
          <div className="pt-2 border-t border-[var(--gridline)] flex flex-col gap-1">
            <div className="flex items-center justify-between text-10 uppercase tracking-wider text-ink-muted pb-0.5">
              <span className="w-28 font-medium">Visual shift</span>
              <span className="flex-1 text-right pr-4 font-medium">Baseline</span>
              <span className="w-3 text-center text-ink-muted/40 font-mono">│</span>
              <span className="flex-1 text-left pl-4 font-medium">Scenario</span>
            </div>

            <VisualBarRow
              label="Unserved"
              baseVal={simResult?.baseline.unserved_energy_mwh ?? 0}
              scenVal={simResult?.scenario.unserved_energy_mwh ?? 0}
              unit="MWh"
              isLowerBetter={true}
            />
            <VisualBarRow
              label="Curtailment"
              baseVal={simResult?.baseline.curtailed_energy_mwh ?? 0}
              scenVal={simResult?.scenario.curtailed_energy_mwh ?? 0}
              unit="MWh"
              isLowerBetter={true}
            />
            <VisualBarRow
              label="Cost"
              baseVal={simResult?.baseline.net_cost_inr ?? 0}
              scenVal={simResult?.scenario.net_cost_inr ?? 0}
              unit=""
              isCurrency={true}
              isLowerBetter={true}
            />
            <VisualBarRow
              label="CO₂"
              baseVal={simResult?.baseline.net_co2_tonnes ?? 0}
              scenVal={simResult?.scenario.net_co2_tonnes ?? 0}
              unit="t"
              isLowerBetter={true}
            />
          </div>
        </section>

        {/* ── LOWER SECTION 2: Recommended response ────────────────── */}
        <section className="p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-baseline justify-between border-b border-[var(--gridline)] pb-2">
            <h2 className="text-12 font-semibold uppercase tracking-wider text-ink-muted">
              Recommended response
            </h2>
            <span className="text-11 text-ink-muted tabular-nums">
              {simResult?.actions.length ?? 0} action
              {(simResult?.actions.length ?? 0) === 1 ? "" : "s"}
            </span>
          </div>

          {simResult?.actions.length === 0 ? (
            <div className="py-2 text-12 text-ink-muted">
              No operational dispatch action required under this scenario.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Primary clean numbered action rows */}
              <div className="flex flex-col divide-y divide-[var(--gridline)]">
                {simResult?.actions.slice(0, 3).map((act, i) => (
                  <div
                    key={`${act.action}-${act.block_start}-${i}`}
                    className="py-2 flex items-baseline justify-between text-12"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-11 text-ink-muted w-4 font-semibold">
                        {i + 1}.
                      </span>
                      <div>
                        <div className="font-semibold text-ink-primary">
                          {formatActionName(act.action)}
                        </div>
                        <div className="text-11 text-ink-muted tabular-nums mt-0.5">
                          {blockRangeToTime(act.block_start, act.block_end)} · {act.magnitude_mw} MW · {act.energy_mwh} MWh
                        </div>
                      </div>
                    </div>

                    <div className="tabular-nums text-11 font-medium">
                      <span
                        className={
                          act.cost_inr < 0
                            ? "text-[var(--delta-pos)]"
                            : act.cost_inr > 0
                              ? "text-ink-secondary"
                              : "text-ink-muted"
                        }
                      >
                        {act.cost_inr < 0
                          ? `−₹${Math.abs(act.cost_inr).toLocaleString("en-IN")}`
                          : `+₹${act.cost_inr.toLocaleString("en-IN")}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* View detailed dispatch plan toggle */}
              {simResult && simResult.actions.length > 0 && (
                <div className="pt-2 border-t border-[var(--gridline)]">
                  <button
                    type="button"
                    onClick={() => setShowFullActions(!showFullActions)}
                    className="text-11 font-medium text-ink-muted hover:text-ink-primary transition-colors cursor-pointer inline-flex items-center gap-1"
                  >
                    <span>
                      {showFullActions
                        ? "Hide detailed dispatch plan ▴"
                        : `View detailed dispatch plan (${simResult.actions.length} actions) ▾`}
                    </span>
                  </button>

                  {showFullActions && (
                    <div className="mt-2.5 divide-y divide-[var(--gridline)] border-t border-[var(--gridline)] pt-2">
                      {simResult.actions.map((act, i) => (
                        <div key={i} className="py-2 flex flex-col gap-0.5 text-12">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-ink-primary">
                              {i + 1}. {formatActionName(act.action)}
                            </span>
                            <span className="text-11 tabular-nums font-medium text-ink-secondary">
                              {act.magnitude_mw} MW · {act.energy_mwh} MWh ·{" "}
                              <span className={act.cost_inr < 0 ? "text-[var(--delta-pos)]" : ""}>
                                {act.cost_inr < 0
                                  ? `−₹${Math.abs(act.cost_inr).toLocaleString("en-IN")}`
                                  : `+₹${act.cost_inr.toLocaleString("en-IN")}`}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between text-11 text-ink-muted">
                            <span>{act.rationale}</span>
                            <span className="tabular-nums font-mono">
                              Blocks {act.block_start}–{act.block_end}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── LOWER SECTION 3: Break-Even Battery ──────────────────── */}
        <section className="p-4 sm:p-5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-[var(--gridline)] pb-2">
            <div>
              <h2 className="text-12 font-semibold uppercase tracking-wider text-ink-muted">
                Break-even battery
              </h2>
              <p className="text-11 text-ink-muted mt-0.5">
                Smallest battery that removes this deficit
              </p>
            </div>
            <span
              className={`rounded-control px-2 py-0.5 text-10 font-medium ${
                simResult?.break_even.feasible
                  ? "bg-[var(--delta-pos)]/12 text-[var(--delta-pos)]"
                  : "bg-[var(--delta-neg)]/12 text-[var(--delta-neg)]"
              }`}
            >
              {simResult?.break_even.feasible ? "Feasible" : "Constraint Bound"}
            </span>
          </div>

          {!hasDeficit ? (
            <div className="text-13 font-medium text-[var(--delta-pos)] pt-1">
              No additional battery required under this scenario.
            </div>
          ) : (
            <div className="flex flex-col gap-1 pt-1">
              <div className="text-18 sm:text-20 font-bold tracking-tight text-ink-primary tabular-nums">
                {minPower} MW · {minEnergy} MWh
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-ink-muted pt-0.5">
                <span>
                  Current battery:{" "}
                  <strong className="text-ink-primary font-medium">
                    {batteryPowerMw} MW · {batteryEnergyMwh} MWh
                  </strong>
                </span>
                {meetsBreakEven ? (
                  <span className="text-[var(--delta-pos)] font-medium">
                    Current battery meets or exceeds break-even.
                  </span>
                ) : (
                  <span>
                    Additional required:{" "}
                    <strong className="text-ink-primary font-medium">
                      +{Math.max(0, minPower - batteryPowerMw)} MW · +
                      {Math.max(0, minEnergy - batteryEnergyMwh)} MWh
                    </strong>
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── LOWER SECTION 4: How the result changed ▾ ────────────── */}
        <section className="p-4 sm:p-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowFullAttribution(!showFullAttribution)}
            className="flex items-center justify-between text-left cursor-pointer w-full group"
          >
            <div>
              <h2 className="text-12 font-semibold uppercase tracking-wider text-ink-muted group-hover:text-ink-primary transition-colors">
                How the result changed {showFullAttribution ? "▴" : "▾"}
              </h2>
              <p className="text-11 text-ink-muted mt-0.5">
                Sequential impact across individual operating levels
              </p>
            </div>
            <span className="text-11 font-medium text-ink-secondary group-hover:text-ink-primary transition-colors">
              {showFullAttribution ? "Hide details ▴" : "Show details ▾"}
            </span>
          </button>

          {/* Compact collapsed state showing Battery, Demand, Grid, Backup, Economics with deltas */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-[var(--gridline)]">
            {attributionSummary.map((item) => (
              <div
                key={item.label}
                className="flex flex-col py-1.5 px-2 rounded-control bg-[var(--page)]/60 border border-[var(--gridline)]"
              >
                <span className="text-10 font-medium uppercase tracking-wider text-ink-muted truncate">
                  {item.label}
                </span>
                <span className={`text-11 font-semibold tabular-nums mt-0.5 ${item.colorClass}`}>
                  {item.deltaText}
                </span>
              </div>
            ))}
          </div>

          {/* Full attribution table only when expanded */}
          {showFullAttribution && simResult && (
            <div className="overflow-x-auto pt-2 border-t border-[var(--gridline)]">
              <table className="w-full text-left text-11">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-ink-muted uppercase tracking-wider">
                    <th className="py-1.5 font-medium">Lever</th>
                    <th className="py-1.5 text-right font-medium">Unserved Δ</th>
                    <th className="py-1.5 text-right font-medium">Curtailed Δ</th>
                    <th className="py-1.5 text-right font-medium">Cost Δ</th>
                    <th className="py-1.5 text-right font-medium">CO₂ Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gridline)] tabular-nums">
                  {simResult.attribution.map((item) => (
                    <tr key={item.lever}>
                      <td className="py-1.5 font-medium text-ink-primary">{item.lever}</td>
                      <td className="py-1.5 text-right text-ink-secondary">
                        {formatDelta(item.unserved_delta_mwh, 1)} MWh
                      </td>
                      <td className="py-1.5 text-right text-ink-secondary">
                        {formatDelta(item.curtailed_delta_mwh, 1)} MWh
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        <span
                          className={
                            item.cost_delta_inr < 0
                              ? "text-[var(--delta-pos)]"
                              : item.cost_delta_inr > 0
                                ? "text-[var(--delta-neg)]"
                                : "text-ink-secondary"
                          }
                        >
                          {formatInrDelta(item.cost_delta_inr)}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-ink-secondary">
                        {formatDelta(item.co2_delta_tonnes, 2)} t
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ── Supporting UI Components ─────────────────────────────────────

function SimulatorTimelineChart({
  timeline,
  capacityMw,
}: {
  timeline: SimulatorTimelineBlock[];
  capacityMw: number;
}) {
  const [hoveredBlock, setHoveredBlock] = useState<SimulatorTimelineBlock | null>(null);

  if (!timeline || timeline.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-11 text-ink-muted">
        Timeline loading…
      </div>
    );
  }

  // Calculate scales
  const maxDataMw = Math.max(
    ...timeline.map((b) => Math.max(b.schedule_mw, b.baseline_dispatch_mw, b.scenario_dispatch_mw)),
    timeline[0]?.evacuation_limit_mw ?? capacityMw,
    100,
  );
  const maxScale = Math.ceil((maxDataMw * 1.06) / 100) * 100;

  // Dimensions
  const svgWidth = 920;
  const svgHeight = 260;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 26;
  const innerW = svgWidth - padLeft - padRight;
  const innerH = svgHeight - padTop - padBottom;

  const getX = (blockIndex: number) => padLeft + (blockIndex / (timeline.length - 1)) * innerW;
  const getY = (mwVal: number) => padTop + innerH - (Math.max(0, mwVal) / maxScale) * innerH;

  // Build SVG path strings
  const schedulePath = timeline
    .map((b, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(b.schedule_mw).toFixed(1)}`)
    .join(" ");

  const baselinePath = timeline
    .map((b, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(b.baseline_dispatch_mw).toFixed(1)}`)
    .join(" ");

  const scenarioPath = timeline
    .map((b, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(b.scenario_dispatch_mw).toFixed(1)}`)
    .join(" ");

  // Fill areas:
  // 1. Where scenario improved over baseline (cleared shortfall):
  const clearedShortfallPolygons: string[] = [];
  let currentRun: { i: number; base: number; scen: number }[] = [];

  timeline.forEach((b, i) => {
    if (b.scenario_dispatch_mw > b.baseline_dispatch_mw + 0.5 && b.baseline_dispatch_mw < b.schedule_mw) {
      currentRun.push({
        i,
        base: b.baseline_dispatch_mw,
        scen: Math.min(b.schedule_mw, b.scenario_dispatch_mw),
      });
    } else {
      if (currentRun.length > 0) {
        const forward = currentRun.map((p) => `${getX(p.i).toFixed(1)},${getY(p.scen).toFixed(1)}`);
        const backward = [...currentRun].reverse().map((p) => `${getX(p.i).toFixed(1)},${getY(p.base).toFixed(1)}`);
        clearedShortfallPolygons.push(`M ${forward.join(" L ")} L ${backward.join(" L ")} Z`);
        currentRun = [];
      }
    }
  });
  if (currentRun.length > 0) {
    const forward = currentRun.map((p) => `${getX(p.i).toFixed(1)},${getY(p.scen).toFixed(1)}`);
    const backward = [...currentRun].reverse().map((p) => `${getX(p.i).toFixed(1)},${getY(p.base).toFixed(1)}`);
    clearedShortfallPolygons.push(`M ${forward.join(" L ")} L ${backward.join(" L ")} Z`);
  }

  // 2. Remaining deficit below schedule in scenario:
  const remainingDeficitPolygons: string[] = [];
  let defRun: { i: number; scen: number; sched: number }[] = [];

  timeline.forEach((b, i) => {
    if (b.scenario_unserved_mw > 0.5 && b.scenario_dispatch_mw < b.schedule_mw) {
      defRun.push({ i, scen: b.scenario_dispatch_mw, sched: b.schedule_mw });
    } else {
      if (defRun.length > 0) {
        const forward = defRun.map((p) => `${getX(p.i).toFixed(1)},${getY(p.sched).toFixed(1)}`);
        const backward = [...defRun].reverse().map((p) => `${getX(p.i).toFixed(1)},${getY(p.scen).toFixed(1)}`);
        remainingDeficitPolygons.push(`M ${forward.join(" L ")} L ${backward.join(" L ")} Z`);
        defRun = [];
      }
    }
  });
  if (defRun.length > 0) {
    const forward = defRun.map((p) => `${getX(p.i).toFixed(1)},${getY(p.sched).toFixed(1)}`);
    const backward = [...defRun].reverse().map((p) => `${getX(p.i).toFixed(1)},${getY(p.scen).toFixed(1)}`);
    remainingDeficitPolygons.push(`M ${forward.join(" L ")} L ${backward.join(" L ")} Z`);
  }

  // Evacuation limit
  const evacLimit = timeline[0]?.evacuation_limit_mw ?? capacityMw;
  const evacY = getY(evacLimit);

  // X ticks every 16 blocks (4 hours)
  const xTicks = [
    { block: 1, label: "00:00" },
    { block: 17, label: "04:00" },
    { block: 33, label: "08:00" },
    { block: 49, label: "12:00" },
    { block: 65, label: "16:00" },
    { block: 81, label: "20:00" },
    { block: 96, label: "24:00" },
  ];

  // Y gridlines
  const yTicks = [0, Math.round(maxScale * 0.33), Math.round(maxScale * 0.66), maxScale];

  return (
    <div className="flex flex-col gap-2">
      {/* Chart Title & Inline Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-11">
        <div>
          <span className="font-semibold uppercase tracking-wider text-ink-primary">
            Current vs scenario
          </span>
          <span className="text-ink-muted text-11 ml-2">
            96-block dispatch timeline
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-10 font-medium">
          <span className="flex items-center gap-1.5 text-ink-muted">
            <span className="w-3.5 h-0.5 border-t border-dashed border-ink-muted inline-block" />
            Schedule
          </span>
          <span className="flex items-center gap-1.5 text-ink-secondary">
            <span className="w-3.5 h-0.5 bg-[var(--baseline)] inline-block" />
            Baseline
          </span>
          <span className="flex items-center gap-1.5 text-ink-primary font-semibold">
            <span className="w-3.5 h-1 bg-[var(--series-1)] inline-block rounded-xs" />
            Scenario
          </span>
          {evacLimit <= maxScale && (
            <span className="flex items-center gap-1.5 text-[var(--delta-neg)]">
              <span className="w-3.5 h-0.5 border-t border-dashed border-[var(--delta-neg)] inline-block" />
              Evacuation limit
            </span>
          )}
        </div>
      </div>

      {/* Hover Readout Bar */}
      <div className="rounded-control bg-[var(--page)]/60 px-3 py-1 text-11 flex items-center justify-between tabular-nums border border-[var(--gridline)] min-h-[28px]">
        {hoveredBlock ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold text-ink-primary">
                Block {hoveredBlock.block} ({hoveredBlock.label})
              </span>
              <span className="text-ink-muted">
                Schedule: <strong className="font-medium text-ink-primary">{hoveredBlock.schedule_mw} MW</strong>
              </span>
              <span className="text-ink-muted">
                Baseline: <strong className="font-medium text-ink-secondary">{hoveredBlock.baseline_dispatch_mw} MW</strong>
              </span>
              <span className="text-ink-muted">
                Scenario: <strong className="font-semibold text-[var(--series-1)]">{hoveredBlock.scenario_dispatch_mw} MW</strong>
              </span>
            </div>
            <div>
              {hoveredBlock.scenario_dispatch_mw !== hoveredBlock.baseline_dispatch_mw && (
                <span
                  className={`font-semibold ${
                    hoveredBlock.scenario_dispatch_mw > hoveredBlock.baseline_dispatch_mw
                      ? "text-[var(--delta-pos)]"
                      : "text-[var(--delta-neg)]"
                  }`}
                >
                  {hoveredBlock.scenario_dispatch_mw > hoveredBlock.baseline_dispatch_mw ? "+" : "−"}
                  {Math.abs(hoveredBlock.scenario_dispatch_mw - hoveredBlock.baseline_dispatch_mw).toFixed(1)} MW
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="text-10 text-ink-muted">
            Hover blocks across the timeline to inspect dispatch values
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full rounded-control bg-surface border border-[var(--gridline)] overflow-hidden">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto block select-none"
          onMouseLeave={() => setHoveredBlock(null)}
        >
          {/* Y Gridlines */}
          {yTicks.map((yVal) => (
            <g key={yVal}>
              <line
                x1={padLeft}
                y1={getY(yVal)}
                x2={padLeft + innerW}
                y2={getY(yVal)}
                stroke="var(--gridline)"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={getY(yVal) + 3}
                textAnchor="end"
                className="text-[9px] fill-[var(--ink-muted)] font-mono tabular-nums"
              >
                {yVal}
              </text>
            </g>
          ))}

          {/* Evacuation Limit Line */}
          {evacLimit <= maxScale && (
            <g>
              <line
                x1={padLeft}
                y1={evacY}
                x2={padLeft + innerW}
                y2={evacY}
                stroke="var(--delta-neg)"
                strokeWidth="1"
                strokeDasharray="4 3"
                opacity="0.8"
              />
              <text
                x={padLeft + innerW - 4}
                y={evacY - 3}
                textAnchor="end"
                className="text-[9px] fill-[var(--delta-neg)] font-mono"
              >
                Evac limit: {evacLimit} MW
              </text>
            </g>
          )}

          {/* Shaded Area: Shortfall Cleared by Scenario (Green Wash) */}
          {clearedShortfallPolygons.map((d, idx) => (
            <path
              key={`cleared-${idx}`}
              d={d}
              fill="var(--delta-pos)"
              fillOpacity="0.18"
            />
          ))}

          {/* Shaded Area: Remaining Deficit below Schedule (Red Wash) */}
          {remainingDeficitPolygons.map((d, idx) => (
            <path
              key={`def-${idx}`}
              d={d}
              fill="var(--delta-neg)"
              fillOpacity="0.2"
            />
          ))}

          {/* Declared Schedule Line */}
          <path
            d={schedulePath}
            fill="none"
            stroke="var(--ink-muted)"
            strokeWidth="1.2"
            strokeDasharray="3 2"
            opacity="0.75"
          />

          {/* Baseline Plan Line */}
          <path
            d={baselinePath}
            fill="none"
            stroke="var(--baseline)"
            strokeWidth="1.6"
          />

          {/* Scenario Plan Line */}
          <path
            d={scenarioPath}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth="2.2"
          />

          {/* Hover Scrub Column */}
          {hoveredBlock && (
            <g>
              <line
                x1={getX(hoveredBlock.block - 1)}
                y1={padTop}
                x2={getX(hoveredBlock.block - 1)}
                y2={padTop + innerH}
                stroke="var(--ink-primary)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={getX(hoveredBlock.block - 1)}
                cy={getY(hoveredBlock.scenario_dispatch_mw)}
                r="3.5"
                fill="var(--series-1)"
                stroke="var(--surface)"
                strokeWidth="1.5"
              />
              <circle
                cx={getX(hoveredBlock.block - 1)}
                cy={getY(hoveredBlock.baseline_dispatch_mw)}
                r="3"
                fill="var(--baseline)"
                stroke="var(--surface)"
                strokeWidth="1"
              />
            </g>
          )}

          {/* Interactive hover rects across 96 blocks */}
          {timeline.map((b, i) => {
            const blockWidth = innerW / 96;
            const blockX = padLeft + (i / 96) * innerW;
            return (
              <rect
                key={b.block}
                x={blockX}
                y={padTop}
                width={blockWidth}
                height={innerH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredBlock(b)}
              />
            );
          })}

          {/* X Ticks & Time Labels */}
          {xTicks.map((tick) => {
            const tx = getX(tick.block - 1);
            return (
              <g key={tick.block}>
                <line
                  x1={tx}
                  y1={padTop + innerH}
                  x2={tx}
                  y2={padTop + innerH + 4}
                  stroke="var(--gridline)"
                  strokeWidth="1"
                />
                <text
                  x={tx}
                  y={padTop + innerH + 14}
                  textAnchor="middle"
                  className="text-[9px] fill-[var(--ink-muted)] font-mono tabular-nums"
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SliderInput({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-11 text-ink-muted">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            id={`${id}-num`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
            }}
            className="w-16 rounded-control border border-[var(--ring)] bg-surface px-1.5 py-0.5 text-right text-11 font-medium tabular-nums text-ink-primary focus:outline-none focus:border-ink-primary"
          />
          <span className="text-10 text-ink-muted">{unit}</span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-[var(--page)] rounded-lg appearance-none cursor-pointer accent-[var(--ink-primary)]"
      />
    </div>
  );
}

function NumberInput({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-ink-muted text-11">
        <label htmlFor={id}>{label}</label>
        <span className="text-10">{unit}</span>
      </div>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className="rounded-control border border-[var(--ring)] bg-surface px-2 py-1 text-11 tabular-nums text-ink-primary focus:outline-none focus:border-ink-primary"
      />
    </div>
  );
}

function DeltaValue({
  val,
  unit = "",
  isCurrency = false,
  isLowerBetter = true,
}: {
  val: number;
  unit?: string;
  isCurrency?: boolean;
  isLowerBetter?: boolean;
}) {
  const isZero = Math.abs(val) < (isCurrency ? 10 : 0.01);
  if (isZero) {
    return <span className="text-ink-muted">0 {unit}</span>;
  }

  const improved = isLowerBetter ? val < 0 : val > 0;
  const colorClass = improved ? "text-[var(--delta-pos)]" : "text-[var(--delta-neg)]";
  const arrow = val < 0 ? "↓" : "↑";
  const formatted = isCurrency
    ? formatInrDelta(val)
    : `${val > 0 ? "+" : "−"}${Math.abs(val).toFixed(1)} ${unit}`;

  return (
    <span className={colorClass}>
      {formatted} {arrow}
    </span>
  );
}

function VisualBarRow({
  label,
  baseVal,
  scenVal,
  unit,
  isCurrency = false,
  isLowerBetter = true,
}: {
  label: string;
  baseVal: number;
  scenVal: number;
  unit: string;
  isCurrency?: boolean;
  isLowerBetter?: boolean;
}) {
  const maxVal = Math.max(Math.abs(baseVal), Math.abs(scenVal), 1);
  const basePct = Math.min(100, Math.max(baseVal === 0 ? 0 : 3, (Math.abs(baseVal) / maxVal) * 100));
  const scenPct = Math.min(100, Math.max(scenVal === 0 ? 0 : 3, (Math.abs(scenVal) / maxVal) * 100));

  const delta = scenVal - baseVal;
  const isZero = Math.abs(delta) < (isCurrency ? 10 : 0.01);
  const improved = isLowerBetter ? delta < 0 : delta > 0;

  const scenColor = isZero
    ? "bg-[var(--baseline)]"
    : improved
      ? "bg-[var(--delta-pos)]"
      : "bg-[var(--delta-neg)]";

  const formatDisplay = (v: number) =>
    isCurrency ? formatInr(v) : `${v.toFixed(1)} ${unit}`;

  return (
    <div className="flex items-center justify-between text-11 py-0.5">
      {/* Label */}
      <span className="w-28 text-ink-primary font-medium truncate">{label}</span>

      {/* Baseline Bar (right aligned towards center divider) */}
      <div className="flex-1 flex items-center justify-end gap-2 pr-4">
        <span className="text-10 text-ink-muted tabular-nums">{formatDisplay(baseVal)}</span>
        <div className="w-24 h-2 bg-[var(--page)] rounded-sm overflow-hidden flex justify-end">
          <div
            className="h-full bg-[var(--baseline)] transition-all duration-200"
            style={{ width: `${basePct}%` }}
          />
        </div>
      </div>

      {/* Center Divider */}
      <span className="w-3 text-center text-ink-muted/40 font-mono text-10">│</span>

      {/* Scenario Bar (left aligned away from center divider) */}
      <div className="flex-1 flex items-center gap-2 pl-4">
        <div className="w-24 h-2 bg-[var(--page)] rounded-sm overflow-hidden flex justify-start">
          <div
            className={`h-full ${scenColor} transition-all duration-200`}
            style={{ width: `${scenPct}%` }}
          />
        </div>
        <span className="text-10 font-semibold text-ink-primary tabular-nums">
          {formatDisplay(scenVal)}
        </span>
      </div>
    </div>
  );
}

// ── Time & Formatting Utilities ──────────────────────────────────

function blockToTime(block: number): string {
  const totalMins = (block - 1) * 15;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function blockRangeToTime(startBlock: number, endBlock: number): string {
  const startStr = blockToTime(startBlock);
  const endMins = endBlock * 15;
  const endHours = Math.floor(endMins / 60);
  const endMinutes = endMins % 60;
  const endStr = `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
  return `${startStr}–${endStr}`;
}

function formatDelta(val: number, decimals = 1): string {
  if (Math.abs(val) < 0.001) return "0.0";
  const sign = val > 0 ? "+" : "−";
  return `${sign}${Math.abs(val).toFixed(decimals)}`;
}

function formatInr(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10_000_000) {
    return `₹${(val / 1e7).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `₹${(val / 1e5).toFixed(1)} L`;
  }
  return `₹${Math.round(val).toLocaleString("en-IN")}`;
}

function formatInrDelta(val: number): string {
  if (Math.abs(val) < 10) return "₹0";
  const sign = val > 0 ? "+" : "−";
  const abs = Math.abs(val);
  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 1e5).toFixed(1)} L`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

function formatActionName(action: string): string {
  switch (action) {
    case "battery_charge":
      return "Charge battery";
    case "battery_discharge":
      return "Discharge battery";
    case "demand_shift":
      return "Shift flexible demand";
    case "gas_peaker":
      return "Start gas peaker";
    case "diesel":
      return "Dispatch diesel backup";
    case "curtail":
      return "Curtail generation";
    default:
      return action;
  }
}
