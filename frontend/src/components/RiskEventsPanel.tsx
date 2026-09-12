"use client";

import { useState } from "react";
import type { RiskEvent, RiskLevel } from "@/lib/types";
import { mw, mwh } from "@/lib/format";

function StatusIcon({ level }: { level: RiskLevel }) {
  if (level === "critical") {
    return (
      <svg
        className="size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--status-critical)"
        strokeWidth="2"
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
        className="size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--status-serious)"
        strokeWidth="2"
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
        className="size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--status-warning)"
        strokeWidth="2"
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
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--status-good)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function statusColorVar(level: RiskLevel): string {
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

export function RiskEventsPanel({ events }: { events?: RiskEvent[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  if (!events || events.length === 0) {
    return (
      <section className="rounded-panel border border-[var(--ring)] bg-surface p-4">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-14 font-semibold text-ink-primary">Operational Risk Events</h2>
            <span className="rounded-full bg-[var(--page)] px-2 py-0.5 text-11 text-ink-muted">
              0 active
            </span>
          </div>
        </header>
        <p className="pt-4 text-13 text-ink-secondary">
          No operational risk events detected. Forecast output tracks declared schedules within safe operating tolerances.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-14 font-semibold text-ink-primary">Operational Risk Events</h2>
          <span className="rounded-full bg-[var(--page)] px-2 py-0.5 text-11 font-medium text-ink-muted">
            {events.length} detected
          </span>
        </div>
        <span className="text-11 text-ink-muted">
          Click an event to view telemetry clues and recommended actions
        </span>
      </header>

      <div className="divide-y divide-[var(--gridline)]">
        {events.map((ev, idx) => {
          const isExpanded = expandedIndex === idx;
          const statusColor = statusColorVar(ev.risk_level);
          const durationHours = ((ev.block_end - ev.block_start + 1) * 0.25).toFixed(1);

          return (
            <div
              key={`${ev.event_type}-${ev.block_start}-${ev.block_end}`}
              className="transition-colors hover:bg-[var(--page)]/40"
            >
              {/* Event Summary Bar */}
              <button
                type="button"
                onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                className="flex w-full flex-col gap-3 px-4 py-3.5 text-left focus:outline-none sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1.5 sm:max-w-[65%]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Icon + text + colour */}
                    <span
                      className="inline-flex items-center gap-1.5 text-12 font-semibold uppercase tracking-wider"
                      style={{ color: statusColor }}
                    >
                      <StatusIcon level={ev.risk_level} />
                      <span>{ev.risk_level}</span>
                    </span>

                    <span className="text-11 font-medium text-ink-muted">·</span>

                    <span className="inline-flex items-center rounded bg-[var(--page)] px-2 py-0.5 text-12 font-semibold tabular-nums text-ink-primary">
                      severity {ev.severity}
                    </span>

                    <span className="text-11 font-medium text-ink-muted">·</span>

                    <span className="text-13 font-medium tabular-nums text-ink-primary">
                      {ev.label}
                    </span>
                    <span className="text-11 text-ink-muted tabular-nums">
                      (Blocks {ev.block_start}–{ev.block_end})
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-13 font-semibold tabular-nums text-ink-primary">
                      {mw(ev.peak_deviation_mw)} peak {ev.event_type}
                    </span>
                    <span className="text-11 text-ink-muted">
                      ({mwh(ev.energy_mwh)} total)
                    </span>
                  </div>

                  <p className="text-13 text-ink-secondary">
                    <strong className="font-medium text-ink-primary">Driver: </strong>
                    {ev.driver}
                  </p>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  {ev.recommended_action ? (
                    <span className="hidden rounded border border-[var(--gridline)] bg-[var(--page)] px-2 py-1 text-11 text-ink-secondary md:inline-block">
                      {ev.recommended_action}
                    </span>
                  ) : null}
                  <span className="btn-secondary text-11">
                    {isExpanded ? "Hide detail ▲" : "View detail ▼"}
                  </span>
                </div>
              </button>

              {/* Expandable Detail Panel */}
              {isExpanded && (
                <div className="border-t border-[var(--gridline)] bg-[var(--page)]/60 px-4 py-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded border border-[var(--gridline)] bg-surface p-3">
                      <div className="text-11 font-medium text-ink-muted">Severity Assessment</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-20 font-bold tabular-nums" style={{ color: statusColor }}>
                          {ev.severity}
                        </span>
                        <span className="text-12 text-ink-muted">/ 100 ({ev.risk_level})</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--page)]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${ev.severity}%`, backgroundColor: statusColor }}
                        />
                      </div>
                    </div>

                    <div className="rounded border border-[var(--gridline)] bg-surface p-3">
                      <div className="text-11 font-medium text-ink-muted">Deviation & Volume</div>
                      <div className="mt-1 text-16 font-semibold tabular-nums text-ink-primary">
                        {mw(ev.peak_deviation_mw)}
                      </div>
                      <div className="mt-1 text-11 text-ink-muted">
                        Total {mwh(ev.energy_mwh)} across window
                      </div>
                    </div>

                    <div className="rounded border border-[var(--gridline)] bg-surface p-3">
                      <div className="text-11 font-medium text-ink-muted">Event Duration</div>
                      <div className="mt-1 text-16 font-semibold tabular-nums text-ink-primary">
                        {durationHours} hours
                      </div>
                      <div className="mt-1 text-11 text-ink-muted">
                        Blocks {ev.block_start} to {ev.block_end} ({ev.block_end - ev.block_start + 1} blocks)
                      </div>
                    </div>

                    <div className="rounded border border-[var(--gridline)] bg-surface p-3">
                      <div className="text-11 font-medium text-ink-muted">Actionable Status</div>
                      <div className="mt-1 flex items-center gap-1.5 text-14 font-semibold text-ink-primary">
                        <span
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: ev.actionable ? "var(--delta-pos)" : "var(--ink-muted)",
                          }}
                        />
                        {ev.actionable ? "Inside Revision Window" : "Locked (Historical)"}
                      </div>
                      <div className="mt-1 text-11 text-ink-muted">
                        {ev.actionable ? "Eligible for schedule re-declaration" : "Committed past revision horizon"}
                      </div>
                    </div>
                  </div>

                  {/* Weather Clue & Recommendation Detail */}
                  <div className="mt-4 flex flex-col gap-2 rounded border border-[var(--gridline)] bg-surface p-3.5">
                    <div>
                      <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
                        Physical Attribution & Clue:
                      </span>
                      <p className="mt-0.5 text-13 text-ink-primary">
                        {ev.driver_detail ?? ev.driver}
                      </p>
                    </div>

                    {ev.recommended_action && (
                      <div className="border-t border-[var(--gridline)] pt-2">
                        <span className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
                          Recommended Action:
                        </span>
                        <p className="mt-0.5 text-13 text-ink-primary">
                          {ev.recommended_action}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
