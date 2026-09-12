"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { StatusDot, riskToStatus } from "@/components/ui";
import { RISK_LABELS, mw } from "@/lib/format";
import type { EnergySummary, RiskLevel, Site } from "@/lib/types";

export interface SiteRiskInfo {
  siteId: string;
  riskLevel: RiskLevel;
  severity: number;
  eventLabel?: string;
  eventType?: string;
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
      <section className="rounded-panel border border-[var(--ring)] bg-surface p-3.5">
        <header className="border-b border-[var(--gridline)] pb-2">
          <h2 className="text-14 font-semibold text-ink-primary">Sites needing attention</h2>
        </header>
        <p className="pt-2 text-12 text-ink-secondary">
          All sites operating within declared schedule parameters.
        </p>
      </section>
    );
  }

  const primaryItems = items.slice(0, 3);
  const extraItems = items.slice(3);
  const hiddenCount = items.length - 3;

  const renderItem = ({ site, risk }: AttentionSiteItem) => {
    if (!risk) return null;
    const statusLevel = riskToStatus(risk.riskLevel);
    return (
      <div
        key={site.id}
        className="flex flex-col gap-1.5 px-4 py-2.5 transition-colors hover:bg-[var(--page)]/30 sm:flex-row sm:items-center sm:justify-between min-h-[58px]"
      >
        {/* Left: 3 concise lines */}
        <div className="flex flex-col gap-0.5 flex-1 min-w-0 pr-4">
          {/* Line 1: Site name · Severity Status */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/sites/${site.id}`}
              className="text-13 font-semibold text-ink-primary hover:underline transition-colors duration-150"
            >
              {site.name}
            </Link>
            <span className="text-ink-muted text-11">·</span>
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-11 font-medium capitalize"
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

          {/* Line 2: Time · Type · Deviation */}
          <div className="flex flex-wrap items-center gap-1.5 text-12 text-ink-secondary tabular-nums">
            {risk.eventLabel && <span>{risk.eventLabel}</span>}
            {risk.eventLabel && risk.eventType && <span className="text-ink-muted">·</span>}
            {risk.eventType && <span className="capitalize">{risk.eventType}</span>}
            {risk.peakDeviationMw !== undefined && (
              <>
                <span className="text-ink-muted">·</span>
                <span className="font-medium text-ink-primary">+{mw(risk.peakDeviationMw)}</span>
              </>
            )}
          </div>

          {/* Line 3: Short driver */}
          {risk.driver && (
            <div className="text-11 text-ink-muted truncate max-w-[65ch]" title={risk.driver}>
              {risk.driver}
            </div>
          )}
        </div>

        {/* Right: Recommended action + Review plan CTA */}
        <div className="flex items-center gap-3 shrink-0 pt-1.5 sm:pt-0 border-t border-[var(--gridline)] sm:border-t-0">
          {risk.recommendedAction && (
            <span className="text-12 font-medium text-ink-primary tabular-nums whitespace-nowrap">
              {risk.recommendedAction}
            </span>
          )}
          <Link
            href={`/sites/${site.id}/decisions`}
            className="btn-secondary"
          >
            <span>Review plan</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="border-b border-[var(--gridline)] px-4 py-2">
        <h2 className="text-14 font-semibold text-ink-primary">Sites needing attention</h2>
      </header>

      <div className="divide-y divide-[var(--gridline)]">
        {primaryItems.map(renderItem)}

        <AnimatePresence initial={false}>
          {expanded && extraItems.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden divide-y divide-[var(--gridline)]"
            >
              {extraItems.map((item, idx) => (
                <motion.div
                  key={item.site.id}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: idx * 0.03, ease: "easeOut" }}
                >
                  {renderItem(item)}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {items.length > 3 && (
        <div className="border-t border-[var(--gridline)] p-2 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="btn-secondary text-11"
          >
            <span>{expanded ? "Show top 3 only ▴" : `View all ${items.length} sites (${hiddenCount} more) ▾`}</span>
          </button>
        </div>
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
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--page)]/30 transition-colors duration-150 select-none"
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
          <h2 className="text-14 font-semibold text-ink-primary flex items-center gap-1.5">
            <span>Operations timing</span>
            <span
              className="inline-block transition-transform duration-200 ease-out text-11 text-ink-muted"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
          </h2>
        </div>
        <span className="text-12 font-medium tabular-nums text-ink-muted">
          Block {currentBlock} · revisable from block {horizonBlock} · {actionableBlocks} actionable
        </span>
      </header>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--gridline)] px-4 py-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
