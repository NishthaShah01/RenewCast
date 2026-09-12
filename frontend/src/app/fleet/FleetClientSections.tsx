"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusDot, riskToStatus } from "@/components/ui";
import { RISK_LABELS, mw } from "@/lib/format";
import type { EnergySummary, RiskLevel, Site } from "@/lib/types";

export interface SiteRiskInfo {
  siteId: string;
  riskLevel: RiskLevel;
  severity: number;
  topEventTitle?: string;
  driver?: string;
  peakDeviationMw?: number;
  recommendedAction?: string;
}

export interface AttentionSiteItem {
  site: Site;
  risk?: SiteRiskInfo;
  energy?: EnergySummary;
}

/* ── Sites Needing Attention (Interactive List, 3 by default) ──────────── */

export function SitesNeedingAttention({
  items,
}: {
  items: AttentionSiteItem[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return (
      <section className="rounded-panel border border-[var(--ring)] bg-surface p-4">
        <header className="flex items-center justify-between border-b border-[var(--gridline)] pb-2.5">
          <h2 className="text-14 font-semibold text-ink-primary">Sites needing attention</h2>
          <span className="text-11 text-ink-muted">0 sites at risk</span>
        </header>
        <p className="pt-3 text-13 text-ink-secondary">
          All sites are operating within standard declared schedule parameters.
          No high-severity operational deviations detected.
        </p>
      </section>
    );
  }

  const visibleItems = expanded ? items : items.slice(0, 3);
  const hiddenCount = items.length - 3;

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-14 font-semibold text-ink-primary">Sites needing attention</h2>
          <span className="text-11 font-medium text-ink-muted">
            ({items.length} sites flagged)
          </span>
        </div>
        <span className="text-11 text-ink-muted">
          Ranked by operational severity
        </span>
      </header>

      <div className="divide-y divide-[var(--gridline)]">
        {visibleItems.map(({ site, risk }) => {
          if (!risk) return null;
          const statusLevel = riskToStatus(risk.riskLevel);
          return (
            <div
              key={site.id}
              className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-[var(--page)]/30 sm:flex-row sm:items-center sm:justify-between min-h-[64px]"
            >
              {/* Left: Site + Risk badge + Event details */}
              <div className="flex flex-col gap-0.5 flex-1 min-w-0 pr-4">
                {/* Line 1: Site name + State + Risk status + severity */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    href={`/sites/${site.id}`}
                    className="text-14 font-semibold text-ink-primary hover:underline"
                  >
                    {site.name}
                  </Link>
                  <span className="text-11 text-ink-muted">({site.state})</span>
                  <span
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-11 font-medium capitalize"
                    style={{
                      backgroundColor: `color-mix(in srgb, var(--status-${statusLevel}) 12%, transparent)`,
                      color: `var(--status-${statusLevel})`,
                      border: `1px solid color-mix(in srgb, var(--status-${statusLevel}) 25%, transparent)`,
                    }}
                  >
                    <StatusDot level={statusLevel} />
                    {RISK_LABELS[risk.riskLevel] ?? risk.riskLevel} {risk.severity}
                  </span>
                </div>

                {/* Line 2: Event window + type + Peak deviation + concise driver */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-12 text-ink-secondary">
                  {risk.topEventTitle && (
                    <span className="font-medium text-ink-primary">
                      {risk.topEventTitle}
                    </span>
                  )}
                  {risk.peakDeviationMw !== undefined && (
                    <>
                      <span className="text-ink-muted" aria-hidden="true">·</span>
                      <span>
                        Peak dev: <strong className="font-semibold tabular-nums text-ink-primary">{mw(risk.peakDeviationMw)}</strong>
                      </span>
                    </>
                  )}
                  {risk.driver && (
                    <>
                      <span className="text-ink-muted" aria-hidden="true">·</span>
                      <span className="truncate max-w-[55ch] text-ink-muted" title={risk.driver}>
                        {risk.driver}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Right: Recommended action + Review plan CTA */}
              <div className="flex items-center gap-4 shrink-0 pt-2 sm:pt-0 border-t border-[var(--gridline)] sm:border-t-0">
                {risk.recommendedAction && (
                  <div className="text-right hidden md:block">
                    <span className="text-11 text-ink-muted block leading-none">Recommended</span>
                    <span className="text-12 font-medium text-ink-primary whitespace-nowrap">
                      {risk.recommendedAction}
                    </span>
                  </div>
                )}
                <Link
                  href={`/sites/${site.id}/decisions`}
                  className="rounded border border-[var(--ring)] bg-surface px-3 py-1.5 text-12 font-medium text-ink-primary hover:bg-[var(--page)] hover:border-ink-primary transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <span>Review plan</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2.5 text-center text-12 font-medium text-ink-secondary hover:text-ink-primary hover:bg-[var(--page)]/50 transition-colors border-t border-[var(--gridline)] flex items-center justify-center gap-1 cursor-pointer"
        >
          <span>{expanded ? "Show top 3 only ▴" : `View all ${items.length} sites (${hiddenCount} more) ▾`}</span>
        </button>
      )}
    </section>
  );
}

/* ── Operations Timing (Collapsible) ───────────────────────────────────── */

export function OperationsTimingCollapsible({
  currentBlock,
  horizonBlock,
  actionableBlocks,
  children,
}: {
  currentBlock: number;
  horizonBlock: number;
  actionableBlocks: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header
        onClick={() => setExpanded(!expanded)}
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--page)]/30 transition-colors select-none"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-14 font-semibold text-ink-primary">
            Operations timing {expanded ? "▴" : "▾"}
          </h2>
        </div>
        <span className="text-12 font-medium tabular-nums text-ink-muted">
          Block {currentBlock} · revisable from block {horizonBlock} · {actionableBlocks} actionable blocks
        </span>
      </header>

      {expanded && (
        <div className="border-t border-[var(--gridline)] px-4 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
