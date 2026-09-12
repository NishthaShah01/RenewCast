"use client";

import { useEffect, useState } from "react";

import {
  BLOCKS_PER_DAY,
  blockLabel,
  blockOf,
  blockStartLabel,
  despatchDate,
  isLocked,
  revisionHorizonBlock,
} from "@/lib/blocks";

/**
 * The 96-block spine.
 *
 * This is the organising structure of the whole product, not a decoration.
 * Every time-series surface in RenewCast is laid out on these same 96
 * columns, so a value's horizontal position means the same thing on every
 * screen.
 *
 * Two markers carry the meaning:
 *
 *   now      — the block currently being generated into
 *   horizon  — the first block a revision issued now could still affect
 *
 * Everything left of the horizon is dimmed and labelled Locked, because no
 * forecast accuracy can change it. That dimming is the argument the product
 * makes: forecast value decays with *delay*, not with horizon alone.
 */
export function BlockSpine() {
  const [state, setState] = useState<{
    now: number;
    horizon: number;
    date: string;
  } | null>(null);

  useEffect(() => {
    const read = () => {
      const d = new Date();
      setState({ now: blockOf(d), horizon: revisionHorizonBlock(d), date: despatchDate(d) });
    };
    read();
    const id = setInterval(read, 10_000);
    return () => clearInterval(id);
  }, []);

  const blocks = Array.from({ length: BLOCKS_PER_DAY }, (_, i) => i + 1);
  // Every 2 hours. Labelling all 24 hours crowds the gutter at this width.
  const tickBlocks = blocks.filter((b) => (b - 1) % 8 === 0);

  return (
    <section
      aria-label="Despatch day"
      className="rounded-panel border border-[var(--ring)] bg-surface"
    >
      <header className="flex items-baseline justify-between border-b border-[var(--gridline)] px-4 py-3">
        <h2 className="text-14 font-semibold">Despatch day</h2>
        <span className="text-11 text-ink-muted tabular-nums">
          {state ? state.date : "—"} · 96 blocks × 15 min
        </span>
      </header>

      <div className="px-4 py-4">
        {/* Label gutter / spine / readout — the three-column grid every
            banded surface in the product uses. */}
        <div className="grid grid-cols-[168px_1fr_104px] items-center gap-4">
          <span className="text-12 font-medium text-ink-secondary">
            Schedule status
          </span>

          <div
            className="flex h-8 w-full gap-px"
            role="img"
            aria-label={
              state
                ? `Blocks 1 to ${state.horizon - 1} are locked. Block ${state.horizon} onward can still be revised.`
                : "Loading despatch day"
            }
          >
            {blocks.map((block) => {
              const locked = state ? isLocked(block, state.horizon) : false;
              const isNow = state?.now === block;
              const isHorizon = state?.horizon === block;
              return (
                <span
                  key={block}
                  title={blockLabel(block)}
                  className="flex-1"
                  style={{
                    background: isNow
                      ? "var(--ink-primary)"
                      : isHorizon
                        ? "var(--series-1)"
                        : locked
                          ? "var(--de-emphasis)"
                          : "var(--seq-250)",
                    // The locked region reads at 55%: present, legible, and
                    // visibly not available to act on.
                    opacity: locked ? 0.55 : 1,
                  }}
                />
              );
            })}
          </div>

          <span className="text-11 text-ink-muted tabular-nums">
            {state ? `${BLOCKS_PER_DAY - state.horizon + 1} actionable` : "—"}
          </span>
        </div>

        {/* Axis ticks in the Condensed cut — the one place it is used. */}
        <div className="grid grid-cols-[168px_1fr_104px] gap-4">
          <span />
          <div className="relative mt-1 h-4">
            {tickBlocks.map((block) => (
              <span
                key={block}
                className="absolute font-condensed text-11 text-ink-muted tabular-nums"
                style={{
                  left: `${((block - 1) / BLOCKS_PER_DAY) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {blockStartLabel(block)}
              </span>
            ))}
          </div>
          <span />
        </div>

        {/* Direct labels, not a colour key. Light-mode aqua and yellow fall
            below 3:1, so the relief rule requires text wherever they appear —
            and a legend the eye must travel to is worse than a label anyway. */}
        <div className="mt-5 grid grid-cols-[168px_1fr_104px] gap-4">
          <span />
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-11 text-ink-secondary">
            <LegendKey color="var(--de-emphasis)" dimmed>
              Locked — gate closed
            </LegendKey>
            <LegendKey color="var(--ink-primary)">
              Now{state ? ` · block ${state.now}` : ""}
            </LegendKey>
            <LegendKey color="var(--series-1)">
              Revision horizon{state ? ` · block ${state.horizon}` : ""}
            </LegendKey>
            <LegendKey color="var(--seq-250)">Revisable</LegendKey>
          </ul>
          <span />
        </div>
      </div>
    </section>
  );
}

function LegendKey({
  color,
  dimmed = false,
  children,
}: {
  color: string;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      {/* A 2px key line, not a filled box. A box reads as a swatch to
          match; a line reads as the mark it actually refers to. */}
      <span
        aria-hidden
        className="h-[2px] w-4 shrink-0"
        style={{ background: color, opacity: dimmed ? 0.55 : 1 }}
      />
      {children}
    </li>
  );
}
