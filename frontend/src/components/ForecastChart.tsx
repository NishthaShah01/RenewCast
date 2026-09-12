"use client";

import { useId, useMemo, useState } from "react";

import { BLOCKS_PER_DAY, blockStartLabel } from "@/lib/blocks";
import { despatchDateLabel } from "@/lib/format";
import type { ForecastBlock } from "@/lib/types";

/**
 * The forecast chart — a fan, not a line.
 *
 * ## Why this is hand-rolled SVG
 *
 * Every charting library wants to own the x-axis. This chart's x-axis is the
 * 96-block despatch spine, shared pixel-for-pixel with `BlockSpine`, the
 * decisions table and the accuracy view — a value's horizontal position means
 * the same thing on every surface in the product. Getting a library to align
 * to an external grid is more work than drawing two paths, and it drags in a
 * theming system that would fight the token layer.
 *
 * ## The band is the message
 *
 * A median line alone invites a reader to treat a forecast as a number. The
 * P10–P90 band is drawn first and drawn large, because the width of that band
 * is the single most decision-relevant thing on the screen: it is the
 * difference between "schedule against this" and "hold reserve".
 *
 * Band width is not constant, and that is the point. A clear desert noon is
 * predictable to a couple of percent; a broken-cloud afternoon is not. A chart
 * that drew a fixed ±10% would be simultaneously too wide at noon and too
 * narrow at 16:00, and would teach the operator to distrust both.
 *
 * ## The locked region is dimmed, never hidden
 *
 * Blocks before the revision horizon are rendered at 55%. What you can no
 * longer change still explains the deviation you are about to be charged for.
 */

const VIEW_W = 960;
const VIEW_H = 280;
const PAD = { top: 16, right: 8, bottom: 28, left: 52 };

const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

interface Props {
  blocks: ForecastBlock[];
  capacityMw: number;
  evacuationMw: number;
  /** Omitted for a future day: there is no revision gate on a day that has
   *  not started, and drawing one would assert a deadline that does not exist. */
  revisionHorizonBlock?: number;
  /** Omitted for a future day — "now" is not on that spine. */
  currentBlock?: number;
  /** Optional declared-capability curve, keyed by block. Drawn as a stepped
   *  reference line when present. */
  scheduleMw?: Map<number, number>;
  technology: "solar" | "wind";
  /** Forces the y-scale instead of deriving it from this day's own data. Two
   *  charts compared side by side must share a ceiling or the taller fan is
   *  the one with the smaller numbers. */
  ceilingMw?: number;
  /** The despatch date, shown in the readout. Only needed where two days are
   *  on screen at once and "block 49" alone is ambiguous. */
  date?: string;
  /** Lifts hover out of the component so two charts can share a block. When
   *  omitted the chart keeps its own hover state, as it always did. */
  hoverBlock?: number | null;
  onHoverBlock?: (block: number | null) => void;
}

export function ForecastChart({
  blocks,
  capacityMw,
  evacuationMw,
  revisionHorizonBlock,
  currentBlock,
  scheduleMw,
  technology,
  ceilingMw,
  date,
  hoverBlock,
  onHoverBlock,
}: Props) {
  const gradientId = useId();
  const clipId = useId();
  const [ownHover, setOwnHover] = useState<number | null>(null);

  // Controlled when the parent passes a handler, uncontrolled otherwise.
  const controlled = onHoverBlock !== undefined;
  const activeBlock = controlled ? (hoverBlock ?? null) : ownHover;
  const setHover = controlled ? onHoverBlock : setOwnHover;

  const geometry = useMemo(() => {
    // The y-scale is anchored to the evacuation limit, not to the data max.
    //
    // Scaling to the data would make every day look the same height and would
    // hide the one thing the chart exists to show on a high-output day: that
    // the forecast is approaching a hard export ceiling. A fixed ceiling means
    // the height of the fan is comparable across days and across sites.
    const ceiling =
      ceilingMw ?? Math.max(evacuationMw, ...blocks.map((b) => b.p90)) * 1.06;

    const x = (block: number) =>
      PAD.left + ((block - 1) / (BLOCKS_PER_DAY - 1)) * PLOT_W;
    const y = (mw: number) => PAD.top + PLOT_H - (mw / ceiling) * PLOT_H;

    const line = (pick: (b: ForecastBlock) => number) =>
      blocks.map((b, i) => `${i === 0 ? "M" : "L"}${x(b.block)},${y(pick(b))}`).join(" ");

    // The band is one closed path: up the P90, back down the P10. Two separate
    // filled areas would seam visibly along the median at low opacity.
    const upper = blocks.map((b) => `${x(b.block)},${y(b.p90)}`);
    const lower = [...blocks].reverse().map((b) => `${x(b.block)},${y(b.p10)}`);
    const band = `M${upper.join(" L")} L${lower.join(" L")} Z`;

    return { ceiling, x, y, band, p50: line((b) => b.p50), physics: line((b) => b.physics_mw) };
  }, [blocks, evacuationMw, ceilingMw]);

  if (blocks.length === 0) return null;

  const { ceiling, x, y, band, p50, physics } = geometry;

  // Gridlines at round numbers, not at even divisions of the ceiling. A reader
  // checking "are we near 1500?" should find 1500 drawn, not 1487.
  const step = niceStep(ceiling);
  const ticks: number[] = [];
  for (let v = 0; v <= ceiling; v += step) ticks.push(v);

  // A future day has no elapsed past and no revision gate, so both marks are
  // absent rather than drawn at block 1. `undefined` here is the caller saying
  // "this day has not started", which is different from "it starts at zero".
  const horizonX = revisionHorizonBlock === undefined ? null : x(revisionHorizonBlock);
  const nowX = currentBlock === undefined ? null : x(currentBlock);
  const tickBlocks = blocks.filter((b) => (b.block - 1) % 8 === 0).map((b) => b.block);

  // The hovered block is addressed by number, not by object, so the same
  // pointer position resolves on two different days' data.
  const hover = activeBlock === null ? null : (blocks.find((b) => b.block === activeBlock) ?? null);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label={describe(blocks, technology)}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {/* A vertical fade, densest at the median. The band's *edges* are
              the least certain part of it, so drawing them at full strength
              would assert more than the model knows. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.10" />
            <stop offset="50%" stopColor="var(--series-1)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.10" />
          </linearGradient>

          {/* Clips the locked overlay to the plot area so it cannot bleed
              into the axis gutter. */}
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>

        {/* ── Gridlines and y-axis ─────────────────────────────────────── */}
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-[var(--ink-muted)] text-11 tabular-nums"
              style={{ fontSize: 11 }}
            >
              {v.toLocaleString("en-IN")}
            </text>
          </g>
        ))}

        {/* ── Evacuation ceiling ───────────────────────────────────────
            Dashed and labelled in place rather than put in a legend. This is
            a constraint, not a series, and it has to read as a different kind
            of thing from the forecast. */}
        {evacuationMw < ceiling && (
          <g>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(evacuationMw)}
              y2={y(evacuationMw)}
              stroke="var(--status-critical)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={PAD.left + PLOT_W}
              y={y(evacuationMw) - 6}
              textAnchor="end"
              className="fill-[var(--status-critical)] text-11"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              Evacuation limit {evacuationMw.toLocaleString("en-IN")} MW
            </text>
          </g>
        )}

        {/* ── The fan ──────────────────────────────────────────────────── */}
        <path d={band} fill={`url(#${gradientId})`} />

        {/* Stage A physics, hairline. Kept visible so the ML correction is
            legible as a correction rather than asserted as truth. */}
        <path
          d={physics}
          fill="none"
          stroke="var(--de-emphasis)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />

        {scheduleMw && (
          <path
            d={stepPath(blocks, scheduleMw, x, y)}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={1.5}
          />
        )}

        <path
          d={p50}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* ── Locked region ────────────────────────────────────────────
            A wash over the past rather than a clipped chart. The forecast for
            an elapsed block is still information — it is the record of what
            you believed when the gate closed.

            Only for the day in progress. A day that has not started has no
            locked blocks, and washing part of it would claim a deadline had
            already passed. */}
        {horizonX !== null && (
          <g clipPath={`url(#${clipId})`}>
            <rect
              x={PAD.left}
              y={PAD.top}
              width={Math.max(horizonX - PAD.left, 0)}
              height={PLOT_H}
              fill="var(--page)"
              opacity={0.45}
            />
          </g>
        )}

        {/* ── Markers ──────────────────────────────────────────────────── */}
        {horizonX !== null && (
          <line
            x1={horizonX}
            x2={horizonX}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--series-1)"
            strokeWidth={1.5}
          />
        )}
        {nowX !== null && (
          <line
            x1={nowX}
            x2={nowX}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--ink-primary)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* ── X axis ───────────────────────────────────────────────────── */}
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          stroke="var(--baseline)"
          strokeWidth={1}
        />
        {tickBlocks.map((b) => (
          <text
            key={b}
            x={x(b)}
            y={VIEW_H - 10}
            textAnchor="middle"
            className="fill-[var(--ink-muted)] tabular-nums"
            style={{ fontSize: 11, fontFamily: "var(--font-condensed)" }}
          >
            {blockStartLabel(b)}
          </text>
        ))}

        {/* ── Hover targets ────────────────────────────────────────────
            One invisible rect per block, full plot height. Hit areas sized to
            the block rather than to the line means the reader never has to
            chase a 2px stroke. */}
        {blocks.map((b) => (
          <rect
            key={b.block}
            x={x(b.block) - PLOT_W / BLOCKS_PER_DAY / 2}
            y={PAD.top}
            width={PLOT_W / BLOCKS_PER_DAY}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(b.block)}
          />
        ))}

        {hover && (
          <g pointerEvents="none" className="transition-all duration-100 ease-out">
            <line
              x1={x(hover.block)}
              x2={x(hover.block)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="var(--ink-secondary)"
              strokeWidth={1}
              strokeDasharray="2,2"
              opacity={0.8}
            />
            <circle cx={x(hover.block)} cy={y(hover.p50)} r={3.5} fill="var(--series-1)" />
            <circle cx={x(hover.block)} cy={y(hover.p90)} r={2} fill="var(--series-1)" opacity={0.6} />
            <circle cx={x(hover.block)} cy={y(hover.p10)} r={2} fill="var(--series-1)" opacity={0.6} />
          </g>
        )}
      </svg>

      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {/* Direct keys, not a floating legend. Light-mode series colours sit
            below 3:1 against the surface, so the relief rule requires a text
            label wherever they carry meaning. */}
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-11 text-ink-secondary">
          <Key color="var(--series-1)">P50 median</Key>
          <Key color="var(--series-1)" band>
            P10–P90 · 80% interval
          </Key>
          {scheduleMw && <Key color="var(--series-2)">Declared schedule</Key>}
          <Key color="var(--de-emphasis)" dashed>
            Physics only
          </Key>
        </ul>

        <ReadOut
          hover={hover}
          capacityMw={capacityMw}
          evacuationMw={evacuationMw}
          date={date}
          scheduleMw={scheduleMw}
        />
      </figcaption>
    </figure>
  );
}

/** The hover readout. Fixed height and tabular figures, so the row beneath
 *  the chart does not reflow as the pointer moves across 96 blocks. */
function ReadOut({
  hover,
  capacityMw,
  evacuationMw,
  date,
  scheduleMw,
}: {
  hover: ForecastBlock | null;
  capacityMw: number;
  evacuationMw: number;
  date?: string;
  scheduleMw?: Map<number, number>;
}) {
  if (!hover) {
    return (
      <p className="text-11 text-ink-muted transition-opacity duration-150 ease-out">
        Hover a block for its interval · {capacityMw.toLocaleString("en-IN")} MW nameplate
      </p>
    );
  }

  const width = hover.p90 - hover.p10;
  const overLimit = hover.p90 > evacuationMw;
  const scheduled = scheduleMw?.get(hover.block);

  return (
    <p className="text-11 tabular-nums text-ink-secondary transition-opacity duration-100 ease-out">
      {/* The date only appears where it disambiguates. On the single-day view
          the panel header already says which day this is. */}
      {date && <span className="text-ink-muted">{despatchDateLabel(date)} · </span>}
      <span className="text-ink-muted">block {hover.block}</span>
      {" · "}
      <strong className="font-semibold text-ink-primary">{hover.label}</strong>
      {" · "}
      <span className="text-ink-muted">P10</span> {Math.round(hover.p10).toLocaleString("en-IN")}
      {" · "}
      <strong className="font-semibold text-ink-primary">
        {Math.round(hover.p50).toLocaleString("en-IN")} MW
      </strong>
      {" · "}
      <span className="text-ink-muted">P90</span> {Math.round(hover.p90).toLocaleString("en-IN")}
      {" · ±"}
      {Math.round(width / 2).toLocaleString("en-IN")} MW
      {scheduled !== undefined && (
        <>
          {" · "}
          <span className="text-ink-muted">schedule</span>{" "}
          {Math.round(scheduled).toLocaleString("en-IN")} MW
        </>
      )}
      {" · lead "}
      {hover.lead_hours.toFixed(1)}h
      {overLimit && (
        <span className="ml-2 font-semibold text-[var(--status-critical)]">
          ▲ above evacuation limit
        </span>
      )}
    </p>
  );
}

function Key({
  color,
  band = false,
  dashed = false,
  children,
}: {
  color: string;
  band?: boolean;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className={band ? "h-3 w-4 shrink-0" : "h-[2px] w-4 shrink-0"}
        style={
          band
            ? { background: color, opacity: 0.26 }
            : dashed
              ? {
                  backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`,
                }
              : { background: color }
        }
      />
      {children}
    </li>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════ */

/** Gridline spacing at a round number near ceiling/5. */
function niceStep(ceiling: number): number {
  const raw = ceiling / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/**
 * A declared schedule is a step function, and drawing it as one matters.
 *
 * A declaration holds a constant value for the whole block — it does not ramp
 * linearly between block centres. Interpolating it would show the plant
 * promising values it never declared, and would make the deviation at each
 * block boundary look smaller than it is.
 */
function stepPath(
  blocks: ForecastBlock[],
  schedule: Map<number, number>,
  x: (b: number) => number,
  y: (mw: number) => number,
): string {
  const half = PLOT_W / BLOCKS_PER_DAY / 2;
  const parts: string[] = [];

  blocks.forEach((b, i) => {
    const v = schedule.get(b.block);
    if (v === undefined) return;
    const left = x(b.block) - half;
    const right = x(b.block) + half;
    parts.push(`${i === 0 || parts.length === 0 ? "M" : "L"}${left},${y(v)}`);
    parts.push(`L${right},${y(v)}`);
  });

  return parts.join(" ");
}

/**
 * The alt text.
 *
 * Describes the shape and the uncertainty, not the pixels. A screen-reader
 * user needs the same two facts a sighted reader takes from the fan: where the
 * peak is, and how wide the band is around it.
 */
function describe(blocks: ForecastBlock[], technology: string): string {
  const peak = blocks.reduce((a, b) => (b.p50 > a.p50 ? b : a));
  const widest = blocks.reduce((a, b) => (b.p90 - b.p10 > a.p90 - a.p10 ? b : a));

  return (
    `Probabilistic ${technology} forecast across 96 despatch blocks. ` +
    `Median peaks at ${Math.round(peak.p50).toLocaleString("en-IN")} megawatts in block ${peak.block}, ${peak.label}. ` +
    `Uncertainty is widest in block ${widest.block} at ${widest.label}, ` +
    `where the 80 percent interval spans ${Math.round(widest.p90 - widest.p10).toLocaleString("en-IN")} megawatts.`
  );
}
