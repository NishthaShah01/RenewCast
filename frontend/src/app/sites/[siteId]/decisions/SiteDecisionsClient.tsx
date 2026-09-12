"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";

import dynamic from "next/dynamic";

import { MotionSection } from "@/components/MotionSection";
import { DeviationStrip } from "@/components/DeviationStrip";

const Copilot = dynamic(() => import("@/components/Copilot").then((mod) => mod.Copilot), {
  loading: () => (
    <div className="rounded-panel border border-[var(--ring)] bg-surface p-4 text-12 text-ink-muted">
      Loading copilot assistant…
    </div>
  ),
});
import { Caveat, Panel, Stat, StatusDot, Td, Th, riskToStatus } from "@/components/ui";
import { blockLabel, blockStartLabel } from "@/lib/blocks";
import {
  ACTION_LABELS,
  RISK_LABELS,
  cost,
  despatchDateLabel,
  inr,
  mw,
  mwh,
  signedMw,
  technologyLabel,
  tonnes,
} from "@/lib/format";
import type {
  DecisionResponse,
  RecommendedAction,
  RiskEvent,
  RiskLevel,
} from "@/lib/types";

/* ── Status helpers ──────────────────────────────────────────────────────── */

function statusColor(level: RiskLevel): string {
  switch (level) {
    case "critical":
      return "var(--status-critical)";
    case "serious":
      return "var(--status-serious)";
    case "watch":
      return "var(--status-warning)";
    case "good":
      return "var(--status-good)";
  }
}

function StatusIcon({ level, className = "size-4" }: { level: RiskLevel; className?: string }) {
  if (level === "critical") {
    return (
      <svg
        className={`${className} shrink-0`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--status-critical)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (level === "serious") {
    return (
      <svg
        className={`${className} shrink-0`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--status-serious)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (level === "watch") {
    return (
      <svg
        className={`${className} shrink-0`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--status-warning)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--status-good)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/* ── Action Timing Semantics Helper ──────────────────────────────────────── */

interface ActionTimingSemantics {
  isActionable: boolean;
  spansHorizon: boolean;
  isPastLocked: boolean;
  timeDisplay: string;
  blocksDisplay: string;
  badgeLabel: string;
}

function getActionTimingSemantics(
  action: RecommendedAction,
  horizonBlock: number,
): ActionTimingSemantics {
  const isPastLocked = action.block_end < horizonBlock;
  const spansHorizon = action.block_start < horizonBlock && action.block_end >= horizonBlock;

  if (isPastLocked) {
    return {
      isActionable: false,
      spansHorizon: false,
      isPastLocked: true,
      timeDisplay: action.label,
      blocksDisplay:
        action.block_start === action.block_end
          ? `Block ${action.block_start}`
          : `Blocks ${action.block_start}–${action.block_end}`,
      badgeLabel: "Locked",
    };
  }

  if (spansHorizon) {
    const startTime = blockStartLabel(horizonBlock);
    const endTime = blockLabel(action.block_end).split("–")[1];
    return {
      isActionable: true,
      spansHorizon: true,
      isPastLocked: false,
      timeDisplay: `actionable from ${startTime} to ${endTime}`,
      blocksDisplay: `Blocks ${horizonBlock}–${action.block_end} (actionable portion · scheduled ${action.block_start}–${action.block_end})`,
      badgeLabel: "Actionable portion",
    };
  }

  // Pure future
  const startTime = blockStartLabel(action.block_start);
  const endTime = blockLabel(action.block_end).split("–")[1];
  return {
    isActionable: true,
    spansHorizon: false,
    isPastLocked: false,
    timeDisplay: `${startTime}–${endTime}`,
    blocksDisplay:
      action.block_start === action.block_end
        ? `Block ${action.block_start}`
        : `Blocks ${action.block_start}–${action.block_end}`,
    badgeLabel: "Actionable",
  };
}

/* ── Main Workspace Component ────────────────────────────────────────────── */

export function SiteDecisionsClient({ decisions }: { decisions: DecisionResponse }) {
  const site = decisions.site;
  const events = decisions.events ?? [];
  const rawActions = decisions.actions ?? [];
  const horizonBlock = decisions.revision_horizon_block;

  // Partition actions into actionable now vs past locked
  const actionableActions = rawActions.filter((a) => a.block_end >= horizonBlock);
  const lockedActions = rawActions.filter((a) => a.block_end < horizonBlock);

  // 1. Primary Event (highest severity event)
  const primaryEvent: RiskEvent | null =
    events.length > 0
      ? [...events].sort((a, b) => b.severity - a.severity)[0]
      : null;

  // Lead Actionable Action for the Hero
  const leadActionable: RecommendedAction | null =
    actionableActions.length > 0 ? actionableActions[0] : null;

  const leadSemantics = leadActionable
    ? getActionTimingSemantics(leadActionable, horizonBlock)
    : null;

  // State for progressive disclosure
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [expandedEventIndex, setExpandedEventIndex] = useState<number | null>(null);
  const [showAllActionable, setShowAllActionable] = useState(false);
  const [showLockedActions, setShowLockedActions] = useState(false);
  const [blocksTableOpen, setBlocksTableOpen] = useState(false);
  const [blocksFilter, setBlocksFilter] = useState<"attention" | "all">("attention");

  // Filtered blocks for 96-block table
  const attentionBlocks = decisions.blocks.filter(
    (b) => b.risk !== "good" || b.curtailment_mw > 0,
  );
  const displayedBlocks =
    blocksFilter === "attention" ? attentionBlocks : decisions.blocks;

  const scrollTo = (elementId: string) => {
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      {/* ──────────────────────────────────────────────────────────────────
          1. COMPACT SITE HEADER
          ────────────────────────────────────────────────────────────────── */}
      {/* ── 1. Compact Site Header ────────────────────────────────────────── */}
      <MotionSection as="header" index={0} className="border-b border-[var(--gridline)] pb-4">
        <nav className="mb-2 text-11 text-ink-muted">
          <Link href="/" className="underline-offset-2 hover:underline">
            Command Centre
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          <Link href="/fleet" className="underline-offset-2 hover:underline">
            Portfolio
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          <Link href={`/sites/${site.id}`} className="underline-offset-2 hover:underline">
            {site.name}
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          <span className="text-ink-primary font-medium">Despatch plan</span>
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h1 className="text-22 sm:text-24 font-semibold tracking-[-0.01em] text-ink-primary">
              {site.name}
            </h1>
            <p className="mt-0.5 text-12 text-ink-secondary">
              {technologyLabel(site.technology)} · {mw(site.capacity_mw)} · {site.state}
            </p>
          </div>

          {/* Operational status line */}
          <div className="flex flex-wrap items-center gap-2 self-start rounded-control border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 tabular-nums shadow-xs sm:self-auto">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-primary">
              <span className="size-2 rounded-full bg-[var(--status-good)]" />
              Block {decisions.current_block}
            </span>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-secondary">{blockLabel(decisions.current_block)} IST</span>
            <span className="text-ink-muted">·</span>
            <span className="font-medium text-ink-primary">
              Revisable from block {decisions.revision_horizon_block}
            </span>
          </div>
        </div>
      </MotionSection>

      {/* ──────────────────────────────────────────────────────────────────
          2. PRIMARY DECISION SUMMARY — HERO
             WHAT IS HAPPENING? & WHAT SHOULD I DO? in < 5 seconds
          ────────────────────────────────────────────────────────────────── */}
      <MotionSection
        as="section"
        index={1}
        className="rounded-panel border bg-surface p-4 sm:p-5 transition-shadow"
        style={{
          borderColor: primaryEvent
            ? `color-mix(in oklab, ${statusColor(primaryEvent.risk_level)} 40%, var(--ring))`
            : "var(--ring)",
        }}
        aria-labelledby="hero-decision-heading"
      >
        <div className="flex flex-col gap-4">
          {/* Header Row: Severity badge + Revision Window status */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {primaryEvent ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-12 font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${statusColor(primaryEvent.risk_level)} 16%, transparent)`,
                    color: statusColor(primaryEvent.risk_level),
                  }}
                >
                  <StatusIcon level={primaryEvent.risk_level} className="size-3.5" />
                  <span>{primaryEvent.risk_level}</span>
                  <span className="text-ink-muted">·</span>
                  <span>Severity {primaryEvent.severity}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-[var(--page)] px-2.5 py-1 text-12 font-bold uppercase tracking-wide text-[var(--status-good)]">
                  <StatusIcon level="good" className="size-3.5" />
                  <span>On Plan · Severity 0</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-11 text-ink-muted">
              {primaryEvent ? (
                primaryEvent.actionable ? (
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--status-good)]">
                    <span className="size-1.5 rounded-full bg-[var(--status-good)]" />
                    Revisable window
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-ink-muted">
                    <span className="size-1.5 rounded-full bg-[var(--ink-muted)]" />
                    Locked (past revision horizon)
                  </span>
                )
              ) : (
                <span className="text-[var(--status-good)] font-medium">All blocks on plan</span>
              )}
            </div>
          </div>

          {/* Event Statement & Core Deviation Metrics */}
          <div className="flex flex-col justify-between gap-4 border-b border-[var(--gridline)] pb-4 sm:flex-row sm:items-center">
            <div>
              <div className="text-11 font-medium uppercase tracking-wider text-ink-muted">
                What is happening
              </div>
              <h2
                id="hero-decision-heading"
                className="mt-1 text-20 font-bold uppercase tracking-tight text-ink-primary sm:text-22"
              >
                {primaryEvent
                  ? `${primaryEvent.event_type} expected`
                  : "Generation tracks declared schedule"}
              </h2>
              <div className="mt-1 text-13 font-medium tabular-nums text-ink-secondary">
                {primaryEvent ? (
                  <>
                    <span>{primaryEvent.label}</span>
                    <span className="mx-1.5 text-ink-muted">·</span>
                    <span>Blocks {primaryEvent.block_start}–{primaryEvent.block_end}</span>
                  </>
                ) : (
                  <span>Next 24 hours · 96 blocks</span>
                )}
              </div>
            </div>

            {/* Quick KPI Strip: Explicit labels without ambiguity */}
            <div className="grid grid-cols-3 gap-3 rounded-control border border-[var(--gridline)] bg-[var(--page)]/50 p-2.5 sm:gap-5 sm:px-4">
              <div>
                <div className="text-11 font-medium text-ink-muted">Peak deviation</div>
                <div className="mt-0.5 text-16 font-bold tabular-nums text-ink-primary">
                  {primaryEvent ? signedMw(primaryEvent.peak_deviation_mw) : "0 MW"}
                </div>
              </div>
              <div>
                <div className="text-11 font-medium text-ink-muted">Event energy at risk</div>
                <div className="mt-0.5 text-16 font-bold tabular-nums text-ink-primary">
                  {primaryEvent ? mwh(primaryEvent.energy_mwh) : "0 MWh"}
                </div>
              </div>
              <div>
                <div className="text-11 font-medium text-ink-muted">Severity score</div>
                <div
                  className="mt-0.5 text-16 font-bold tabular-nums"
                  style={{
                    color: primaryEvent ? statusColor(primaryEvent.risk_level) : "var(--status-good)",
                  }}
                >
                  {primaryEvent ? `${primaryEvent.severity}/100` : "0/100"}
                </div>
              </div>
            </div>
          </div>

          {/* WHY & UNAMBIGUOUS RECOMMENDED ACTION */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-control border border-[var(--gridline)] bg-[var(--page)]/40 p-3">
              <span className="text-11 font-bold uppercase tracking-wider text-ink-muted">
                Why:
              </span>
              <p className="mt-1 text-13 leading-relaxed text-ink-secondary">
                {primaryEvent ? (primaryEvent.driver_detail ?? primaryEvent.driver) : (
                  "Declared schedule sits comfortably inside the forecast interval across all remaining blocks today."
                )}
              </p>
            </div>

            <div className="rounded-control border border-[var(--gridline)] bg-[var(--page)]/40 p-3 flex flex-col justify-between gap-2">
              <div>
                <span className="text-11 font-bold uppercase tracking-wider text-ink-muted">
                  Recommended action:
                </span>
                <div className="mt-1">
                  {leadActionable && leadSemantics ? (
                    <div>
                      <div className="text-14 font-bold text-ink-primary">
                        {ACTION_LABELS[leadActionable.action] ?? leadActionable.action}
                      </div>
                      <div className="mt-0.5 text-12 font-medium text-ink-secondary tabular-nums">
                        {mw(leadActionable.magnitude_mw)} · {leadSemantics.timeDisplay}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-14 font-medium text-ink-secondary">
                        {lockedActions.length > 0
                          ? "No actionable runs remain today"
                          : "Maintain declared generation schedule"}
                      </div>
                      <div className="mt-0.5 text-11 text-ink-muted">
                        {lockedActions.length > 0
                          ? `All identified runs fall inside the locked window (prior to block ${horizonBlock})`
                          : "Schedule matches median forecast within tolerance"}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Primary Action Affordance */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => scrollTo("despatch-plan")}
                  className="btn-accent"
                >
                  <span>Review despatch plan</span>
                  <span aria-hidden>↓</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </MotionSection>

      {/* ──────────────────────────────────────────────────────────────────
          3. DESPATCH PLAN
             Concise summary + timeline directly beneath hero.
          ────────────────────────────────────────────────────────────────── */}
      <MotionSection as="section" index={2} id="despatch-plan" className="scroll-mt-4">
        <Panel
          title="Despatch plan"
          meta={despatchDateLabel(decisions.despatch_date)}
          action={
            <button
              type="button"
              onClick={() => {
                setBlocksTableOpen(true);
                setTimeout(() => scrollTo("detailed-blocks-section"), 50);
              }}
              className="btn-secondary text-11"
            >
              View full plan →
            </button>
          }
          footnote="Cost is signed: positive is money spent, negative is money saved. Shortfall is measured against the P10 floor, surplus and curtailment against the P90 ceiling."
        >
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 px-4 py-4 sm:grid-cols-4">
            <Stat
              label="Net cost of plan"
              value={inr(Math.abs(decisions.net_cost_inr))}
              tone={decisions.net_cost_inr < 0 ? "positive" : "negative"}
              note={decisions.net_cost_inr < 0 ? "Net saving" : "Net spend"}
            />
            <Stat
              label="Total shortfall risk"
              value={mwh(decisions.deficit_energy_mwh)}
              note="Against P10 floor"
            />
            <Stat
              label="Total curtailment"
              value={mwh(decisions.curtailment_energy_mwh)}
              note={`Above ${mw(site.evacuation_limit_mw)} limit`}
              tone={decisions.curtailment_energy_mwh > 0 ? "negative" : undefined}
            />
            <Stat
              label="Net CO₂"
              value={tonnes(decisions.net_co2_tonnes)}
              tone={decisions.net_co2_tonnes < 0 ? "positive" : undefined}
              note={decisions.net_co2_tonnes < 0 ? "Avoided" : "Emitted"}
            />
          </dl>

          <div className="border-t border-[var(--gridline)] px-4 py-4">
            <DeviationStrip
              blocks={decisions.blocks}
              horizonBlock={decisions.revision_horizon_block}
              currentBlock={decisions.current_block}
            />
          </div>

          <div className="border-t border-[var(--gridline)] px-4 py-3">
            <Caveat>{decisions.schedule_basis}</Caveat>
          </div>
        </Panel>
      </MotionSection>

      {/* ──────────────────────────────────────────────────────────────────
          4. OPERATIONAL RISK EVENTS — PROGRESSIVE DISCLOSURE
             Top 3 most important events initially.
          ────────────────────────────────────────────────────────────────── */}
      <MotionSection as="section" index={3} className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-14 font-semibold text-ink-primary">Operational risk events</h2>
            <span className="rounded-full bg-[var(--page)] px-2 py-0.5 text-11 font-medium text-ink-muted">
              {events.length} detected
            </span>
          </div>
          <span className="text-11 text-ink-muted">
            {events.length > 3 && !showAllEvents
              ? "Showing top 3 by severity"
              : "Ranked by severity"}
          </span>
        </header>

        {events.length === 0 ? (
          <p className="px-4 py-5 text-13 text-ink-secondary">
            No operational risk events detected. Forecast output tracks declared schedules within safe operating tolerances.
          </p>
        ) : (
          <div>
            <div className="divide-y divide-[var(--gridline)]">
              {events.slice(0, 3).map((ev, idx) => {
                const isExpanded = expandedEventIndex === idx;
                const statusCol = statusColor(ev.risk_level);
                const durationHours = ((ev.block_end - ev.block_start + 1) * 0.25).toFixed(1);

                return (
                  <div
                    key={`${ev.event_type}-${ev.block_start}-${ev.block_end}`}
                    className="transition-colors hover:bg-[var(--page)]/40"
                  >
                    {/* Compact Event Row */}
                    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-1 flex-col gap-1 sm:max-w-[70%]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="inline-flex items-center gap-1.5 text-12 font-bold uppercase tracking-wide"
                            style={{ color: statusCol }}
                          >
                            <StatusIcon level={ev.risk_level} className="size-3.5" />
                            <span>{ev.risk_level}</span>
                            <span className="text-ink-muted">·</span>
                            <span>{ev.severity}</span>
                          </span>

                          <span className="text-11 text-ink-muted">·</span>

                          <span className="text-13 font-semibold tabular-nums text-ink-primary">
                            {ev.label}
                          </span>
                          <span className="text-12 capitalize text-ink-secondary">
                            ({ev.event_type})
                          </span>

                          <span className="text-11 text-ink-muted">·</span>

                          <span className="text-13 font-semibold tabular-nums text-ink-primary">
                            Peak deviation {signedMw(ev.peak_deviation_mw)}
                          </span>
                        </div>

                        <p className="text-12 text-ink-secondary">
                          <span className="font-medium text-ink-primary">Driver: </span>
                          {ev.driver}
                        </p>

                        {ev.recommended_action ? (
                          <div className="flex flex-wrap items-center gap-2 text-12 text-ink-primary">
                            <span className="font-medium text-ink-muted">Recommended: </span>
                            <span className="font-medium">{ev.recommended_action}</span>
                            {!ev.actionable && (
                              <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider text-ink-muted">
                                Locked event
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {/* Detail Toggle Button */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => setExpandedEventIndex(isExpanded ? null : idx)}
                          className="btn-secondary text-11"
                        >
                          {isExpanded ? "Hide details ▲" : "View details →"}
                        </button>
                      </div>
                    </div>

                    {/* Compact Expandable Detail */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-[var(--gridline)] bg-[var(--page)]/50 px-4 py-3.5">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                <div className="text-11 text-ink-muted">Severity score</div>
                                <div className="mt-1 text-16 font-bold tabular-nums" style={{ color: statusCol }}>
                                  {ev.severity} / 100
                                </div>
                              </div>

                              <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                <div className="text-11 text-ink-muted">Duration & Blocks</div>
                                <div className="mt-1 text-14 font-semibold tabular-nums text-ink-primary">
                                  {durationHours} h
                                </div>
                                <div className="text-11 text-ink-muted">
                                  Blocks {ev.block_start}–{ev.block_end}
                                </div>
                              </div>

                              <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                <div className="text-11 text-ink-muted">Deviation & Volume</div>
                                <div className="mt-1 text-14 font-semibold tabular-nums text-ink-primary">
                                  {mw(ev.peak_deviation_mw)}
                                </div>
                                <div className="text-11 text-ink-muted">{mwh(ev.energy_mwh)} total</div>
                              </div>

                              <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                <div className="text-11 text-ink-muted">Revision Status</div>
                                <div className="mt-1 flex items-center gap-1.5 text-13 font-semibold text-ink-primary">
                                  <span
                                    className="size-2 rounded-full"
                                    style={{
                                      backgroundColor: ev.actionable ? "var(--delta-pos)" : "var(--ink-muted)",
                                    }}
                                  />
                                  {ev.actionable ? "Inside revision window" : "Locked (past horizon)"}
                                </div>
                              </div>
                            </div>

                            {ev.driver_detail && (
                              <div className="mt-2.5 rounded border border-[var(--gridline)] bg-surface p-2.5 text-12 text-ink-secondary">
                                <strong className="font-semibold text-ink-primary">Telemetry clue: </strong>
                                {ev.driver_detail}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              <AnimatePresence initial={false}>
                {showAllEvents && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="divide-y divide-[var(--gridline)] overflow-hidden"
                  >
                    {events.slice(3).map((ev, i) => {
                      const idx = i + 3;
                      const isExpanded = expandedEventIndex === idx;
                      const statusCol = statusColor(ev.risk_level);
                      const durationHours = ((ev.block_end - ev.block_start + 1) * 0.25).toFixed(1);

                      return (
                        <motion.div
                          key={`${ev.event_type}-${ev.block_start}-${ev.block_end}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.18, delay: i * 0.03 }}
                          className="transition-colors hover:bg-[var(--page)]/40"
                        >
                          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-1 flex-col gap-1 sm:max-w-[70%]">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="inline-flex items-center gap-1.5 text-12 font-bold uppercase tracking-wide"
                                  style={{ color: statusCol }}
                                >
                                  <StatusIcon level={ev.risk_level} className="size-3.5" />
                                  <span>{ev.risk_level}</span>
                                  <span className="text-ink-muted">·</span>
                                  <span>{ev.severity}</span>
                                </span>

                                <span className="text-11 text-ink-muted">·</span>

                                <span className="text-13 font-semibold tabular-nums text-ink-primary">
                                  {ev.label}
                                </span>
                                <span className="text-12 capitalize text-ink-secondary">
                                  ({ev.event_type})
                                </span>

                                <span className="text-11 text-ink-muted">·</span>

                                <span className="text-13 font-semibold tabular-nums text-ink-primary">
                                  Peak deviation {signedMw(ev.peak_deviation_mw)}
                                </span>
                              </div>

                              <p className="text-12 text-ink-secondary">
                                <span className="font-medium text-ink-primary">Driver: </span>
                                {ev.driver}
                              </p>

                              {ev.recommended_action ? (
                                <div className="flex flex-wrap items-center gap-2 text-12 text-ink-primary">
                                  <span className="font-medium text-ink-muted">Recommended: </span>
                                  <span className="font-medium">{ev.recommended_action}</span>
                                  {!ev.actionable && (
                                    <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider text-ink-muted">
                                      Locked event
                                    </span>
                                  )}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => setExpandedEventIndex(isExpanded ? null : idx)}
                                className="btn-secondary text-11"
                              >
                                {isExpanded ? "Hide details ▲" : "View details →"}
                              </button>
                            </div>
                          </div>

                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                                className="overflow-hidden"
                              >
                                <div className="border-t border-[var(--gridline)] bg-[var(--page)]/50 px-4 py-3.5">
                                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                      <div className="text-11 text-ink-muted">Severity score</div>
                                      <div className="mt-1 text-16 font-bold tabular-nums" style={{ color: statusCol }}>
                                        {ev.severity} / 100
                                      </div>
                                    </div>

                                    <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                      <div className="text-11 text-ink-muted">Duration & Blocks</div>
                                      <div className="mt-1 text-14 font-semibold tabular-nums text-ink-primary">
                                        {durationHours} h
                                      </div>
                                      <div className="text-11 text-ink-muted">
                                        Blocks {ev.block_start}–{ev.block_end}
                                      </div>
                                    </div>

                                    <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                      <div className="text-11 text-ink-muted">Deviation & Volume</div>
                                      <div className="mt-1 text-14 font-semibold tabular-nums text-ink-primary">
                                        {mw(ev.peak_deviation_mw)}
                                      </div>
                                      <div className="text-11 text-ink-muted">{mwh(ev.energy_mwh)} total</div>
                                    </div>

                                    <div className="rounded border border-[var(--gridline)] bg-surface p-2.5">
                                      <div className="text-11 text-ink-muted">Revision Status</div>
                                      <div className="mt-1 flex items-center gap-1.5 text-13 font-semibold text-ink-primary">
                                        <span
                                          className="size-2 rounded-full"
                                          style={{
                                            backgroundColor: ev.actionable ? "var(--delta-pos)" : "var(--ink-muted)",
                                          }}
                                        />
                                        {ev.actionable ? "Inside revision window" : "Locked (past horizon)"}
                                      </div>
                                    </div>
                                  </div>

                                  {ev.driver_detail && (
                                    <div className="mt-2.5 rounded border border-[var(--gridline)] bg-surface p-2.5 text-12 text-ink-secondary">
                                      <strong className="font-semibold text-ink-primary">Telemetry clue: </strong>
                                      {ev.driver_detail}
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Expand / Collapse All Events */}
            {events.length > 3 && (
              <div className="border-t border-[var(--gridline)] px-4 py-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllEvents(!showAllEvents)}
                  className="btn-secondary text-11"
                >
                  {showAllEvents
                    ? "Show fewer events ↑"
                    : `View all ${events.length} events (${events.length - 3} more) ↓`}
                </button>
              </div>
            )}
          </div>
        )}
      </MotionSection>

      {/* ──────────────────────────────────────────────────────────────────
          5. RECOMMENDED ACTIONS — ACTIONABLE FIRST, LOCKED SUBORDINATED
          ────────────────────────────────────────────────────────────────── */}
      <MotionSection as="section" index={4} id="recommended-actions" className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-14 font-semibold text-ink-primary">Recommended actions</h2>
            <span className="rounded-full bg-[var(--page)] px-2 py-0.5 text-11 font-medium text-ink-muted">
              {actionableActions.length} actionable
              {lockedActions.length > 0 ? ` · ${lockedActions.length} locked` : ""}
            </span>
          </div>
          <span className="text-11 text-ink-muted">
            {actionableActions.length > 0
              ? "Ordered by merit · revisable from block " + horizonBlock
              : "All runs committed"}
          </span>
        </header>

        {/* 5A. Actionable Actions List (Prominent) */}
        {actionableActions.length === 0 ? (
          <div className="p-4 sm:p-5 text-13 text-ink-secondary">
            <p className="font-medium text-ink-primary">
              No actionable runs available for schedule revision today.
            </p>
            <p className="mt-1 text-12 text-ink-muted leading-relaxed">
              Every identified remedy ends before revision block {horizonBlock} (locked gate),
              or the declared generation schedule tracks within operating tolerances.
            </p>
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-13">
                <thead>
                  <tr className="border-b border-[var(--gridline)] bg-[var(--page)]/40">
                    <Th width="40%">Action</Th>
                    <Th width="22%">Actionable Time Window</Th>
                    <Th numeric width="12%">Power</Th>
                    <Th numeric width="12%">Cost</Th>
                    <Th numeric width="14%">CO₂</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gridline)]">
                  {(showAllActionable ? actionableActions : actionableActions.slice(0, 3)).map(
                    (a, i) => {
                      const money = cost(a.cost_inr);
                      const sem = getActionTimingSemantics(a, horizonBlock);
                      return (
                        <tr
                          key={`${a.action}-${a.block_start}-${i}`}
                          className="align-top transition-colors hover:bg-[var(--page)]/40"
                        >
                          <Td>
                            <div className="flex items-baseline gap-2">
                              <span className="font-semibold text-ink-primary">
                                {i + 1}. {ACTION_LABELS[a.action] ?? a.action}
                              </span>
                              <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider text-[var(--status-good)]">
                                {sem.badgeLabel}
                              </span>
                            </div>
                            <p className="mt-0.5 text-12 text-ink-secondary leading-snug">
                              {a.rationale}
                            </p>
                          </Td>
                          <Td muted>
                            <div className="tabular-nums font-medium text-ink-primary capitalize">
                              {sem.timeDisplay}
                            </div>
                            <div className="text-11 text-ink-muted tabular-nums">
                              {sem.blocksDisplay}
                            </div>
                          </Td>
                          <Td numeric>
                            <div className="font-medium text-ink-primary">{mw(a.magnitude_mw)}</div>
                            <div className="text-11 text-ink-muted">{mwh(a.energy_mwh)}</div>
                          </Td>
                          <Td numeric>
                            <span
                              className="font-semibold tabular-nums"
                              style={{ color: money.saving ? "var(--delta-pos)" : "var(--delta-neg)" }}
                            >
                              {money.saving ? "saves " : ""}
                              {money.text}
                            </span>
                          </Td>
                          <Td numeric muted>
                            <span className="tabular-nums">{tonnes(a.co2_tonnes)}</span>
                          </Td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            {/* Expand / Collapse Actionable Actions if > 3 */}
            {actionableActions.length > 3 && (
              <div className="border-t border-[var(--gridline)] px-4 py-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllActionable(!showAllActionable)}
                  className="btn-secondary text-11"
                >
                  {showAllActionable
                    ? "Show fewer actionable actions ↑"
                    : `View all ${actionableActions.length} actionable actions (${actionableActions.length - 3} more) ↓`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 5B. Visually Subordinated Locked Actions Region */}
        {lockedActions.length > 0 && (
          <div className="border-t border-[var(--gridline)] bg-[var(--page)]/30">
            <button
              type="button"
              onClick={() => setShowLockedActions(!showLockedActions)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-12 font-medium text-ink-muted hover:text-ink-primary hover:bg-[var(--page)]/40 transition-colors focus:outline-none cursor-pointer"
              aria-expanded={showLockedActions}
            >
              <span className="flex items-center gap-2">
                <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wider text-ink-muted">
                  Locked
                </span>
                <span>
                  {lockedActions.length} locked {lockedActions.length === 1 ? "action" : "actions"} (no longer actionable)
                </span>
              </span>
              <span className="btn-ghost text-11">
                {showLockedActions ? "Hide locked actions ▲" : "View locked actions ▾"}
              </span>
            </button>

            <AnimatePresence initial={false}>
              {showLockedActions && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-[var(--gridline)] overflow-x-auto opacity-75">
                    <table className="w-full text-12">
                      <thead>
                        <tr className="border-b border-[var(--gridline)] bg-[var(--page)]/60 text-ink-muted">
                          <Th width="40%">Past Action (Committed)</Th>
                          <Th width="22%">Past Time / Blocks</Th>
                          <Th numeric width="12%">Power</Th>
                          <Th numeric width="12%">Cost</Th>
                          <Th numeric width="14%">CO₂</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--gridline)]">
                        {lockedActions.map((a, i) => {
                          const money = cost(a.cost_inr);
                          return (
                            <tr
                              key={`locked-${a.action}-${a.block_start}-${i}`}
                              className="align-top hover:bg-[var(--page)]/40"
                            >
                              <Td>
                                <div className="flex items-baseline gap-2">
                                  <span className="font-medium text-ink-secondary">
                                    {ACTION_LABELS[a.action] ?? a.action}
                                  </span>
                                  <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-10 text-ink-muted">
                                    Locked
                                  </span>
                                </div>
                                <p className="mt-0.5 text-11 text-ink-muted leading-snug">
                                  {a.rationale}
                                </p>
                              </Td>
                              <Td muted>
                                <div className="tabular-nums font-medium text-ink-secondary">{a.label}</div>
                                <div className="text-10 text-ink-muted tabular-nums">
                                  Blocks {a.block_start}–{a.block_end}
                                </div>
                              </Td>
                              <Td numeric>
                                <div className="font-medium text-ink-secondary">{mw(a.magnitude_mw)}</div>
                                <div className="text-10 text-ink-muted">{mwh(a.energy_mwh)}</div>
                              </Td>
                              <Td numeric>
                                <span
                                  className="font-medium tabular-nums"
                                  style={{ color: money.saving ? "var(--delta-pos)" : "var(--delta-neg)" }}
                                >
                                  {money.saving ? "saves " : ""}
                                  {money.text}
                                </span>
                              </Td>
                              <Td numeric muted>
                                <span className="tabular-nums">{tonnes(a.co2_tonnes)}</span>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="border-t border-[var(--gridline)] px-4 py-2 text-11 text-ink-muted">
                      These runs ended before revision block {horizonBlock} and cannot be modified. They explain the current state and settlement charges.
                    </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      </MotionSection>

      {/* ── 6. Copilot ──────────────────────────────────────────────────── */}
      <MotionSection as="section" index={5}>
        <Copilot siteId={site.id} siteName={site.name} />
      </MotionSection>

      {/* ── 7. Detailed Block View ──────────────────────────────────────── */}
      <MotionSection as="section" index={6} id="detailed-blocks-section" className="rounded-panel border border-[var(--ring)] bg-surface">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-3">
          <button
            type="button"
            onClick={() => setBlocksTableOpen(!blocksTableOpen)}
            className="flex items-center gap-2 text-left active:scale-[0.99] transition-all duration-150 focus:outline-none"
            aria-expanded={blocksTableOpen}
          >
            <h2 className="text-14 font-semibold text-ink-primary">
              Detailed block view {blocksTableOpen ? "▲" : "▾"}
            </h2>
            <span className="text-11 text-ink-muted">
              ({decisions.blocks.length} blocks · {attentionBlocks.length} needing attention)
            </span>
          </button>

          {blocksTableOpen && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBlocksFilter("attention")}
                className={`rounded px-2 py-1 text-11 font-medium active:scale-[0.98] transition-all duration-150 ${
                  blocksFilter === "attention"
                    ? "bg-[var(--ink-primary)] text-[var(--surface)]"
                    : "bg-[var(--page)] text-ink-secondary hover:text-ink-primary"
                }`}
              >
                Needing attention ({attentionBlocks.length})
              </button>
              <button
                type="button"
                onClick={() => setBlocksFilter("all")}
                className={`rounded px-2 py-1 text-11 font-medium active:scale-[0.98] transition-all duration-150 ${
                  blocksFilter === "all"
                    ? "bg-[var(--ink-primary)] text-[var(--surface)]"
                    : "bg-[var(--page)] text-ink-secondary hover:text-ink-primary"
                }`}
              >
                All 96 blocks
              </button>
            </div>
          )}
        </header>

        <AnimatePresence initial={false}>
          {blocksTableOpen ? (
            <motion.div
              key="blocks-table"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                <table className="w-full text-13">
                  <thead className="sticky top-0 z-10 bg-[var(--surface)] shadow-xs">
                    <tr className="border-b border-[var(--gridline)]">
                      <Th>Block</Th>
                      <Th>Risk</Th>
                      <Th numeric>Severity</Th>
                      <Th numeric>Declared</Th>
                      <Th numeric>P50</Th>
                      <Th numeric>Deviation</Th>
                      <Th numeric>Shortfall</Th>
                      <Th numeric>Curtailment</Th>
                      <Th>Physical Driver</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--gridline)]">
                    {displayedBlocks.map((b) => (
                      <tr
                        key={b.block}
                        className="transition-colors hover:bg-[var(--page)]/40"
                        style={b.locked ? { opacity: 0.6 } : undefined}
                      >
                        <Td>
                          <span className="tabular-nums font-medium">{b.label}</span>
                          <span className="ml-2 text-11 text-ink-muted tabular-nums">
                            #{b.block}
                          </span>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-1.5">
                            <StatusDot level={riskToStatus(b.risk)} />
                            <span className="capitalize text-12 font-medium">
                              {RISK_LABELS[b.risk] ?? b.risk}
                            </span>
                          </span>
                        </Td>
                        <Td numeric>
                          <span className="font-semibold tabular-nums text-ink-primary">
                            {b.severity ?? 0}
                          </span>
                          <span className="text-10 text-ink-muted">/100</span>
                        </Td>
                        <Td numeric>{mw(b.schedule_mw)}</Td>
                        <Td numeric muted>{mw(b.p50)}</Td>
                        <Td numeric>
                          <span
                            className="font-medium"
                            style={{
                              color: b.deviation_mw > 0 ? "var(--delta-neg)" : "var(--ink-secondary)",
                            }}
                          >
                            {signedMw(b.deviation_mw)}
                          </span>
                        </Td>
                        <Td numeric muted>{b.deficit_mw > 0 ? mw(b.deficit_mw) : "—"}</Td>
                        <Td numeric>
                          {b.curtailment_mw > 0 ? (
                            <span className="font-semibold" style={{ color: "var(--delta-neg)" }}>
                              {mw(b.curtailment_mw)}
                            </span>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </Td>
                        <Td>
                          <span className="text-12 text-ink-secondary line-clamp-1" title={b.driver ?? undefined}>
                            {b.driver ?? "—"}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-[var(--gridline)] px-4 py-2.5 text-11 text-ink-muted">
                Deviation is the declared schedule minus the P50 forecast. Locked rows (inside the revision horizon) are shown dimmed.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="blocks-collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="px-4 py-3 text-12 text-ink-muted"
            >
              Click to expand 96-block telemetry, quantile forecasts, and physical drivers.
            </motion.div>
          )}
        </AnimatePresence>
      </MotionSection>
    </div>
  );
}
