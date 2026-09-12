"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { blockStartLabel } from "@/lib/blocks";
import { resolveDay, type ForecastDay } from "@/lib/days";
import { despatchDateLabel, mw, mwh, signedMw } from "@/lib/format";
import type { ForecastBlock, Site } from "@/lib/types";

import { ForecastChart } from "./ForecastChart";

/**
 * One day at a time, with comparison on request.
 *
 * ## Why one chart and not three
 *
 * A 96-block fan needs the full width of the page to be readable — at a third
 * of it, the 15-minute blocks are two pixels wide and the P10–P90 band, the
 * thing the chart exists to show, collapses into a line. Three stacked charts
 * would also make the reader scroll to compare, which is the one thing
 * comparison must not require.
 *
 * So the horizon decides which days exist, a selector picks the one in view,
 * and the data is replaced inside the same chart surface. The operator's normal
 * question is "what does tomorrow look like", not "how do three days differ" —
 * and when it is the second question, that is what Compare is for.
 *
 * ## Switching day does not hit the network
 *
 * Every day the horizon allows is already in the response the server rendered.
 * Day switching is a client-side slice of data that has arrived; only changing
 * the horizon is a new request. That is why this is one client component around
 * the chart rather than a URL parameter per day.
 */

interface Props {
  days: ForecastDay[];
  site: Site;
  /** Today's declared capability, keyed by block. Sent as pairs because this
   *  crosses the server/client boundary. */
  schedule?: [number, number][];
  /** Both omitted-for-future-days markers, for today only. */
  currentBlock: number;
  revisionHorizonBlock: number;
}

export function ForecastExplorer({
  days,
  site,
  schedule,
  currentBlock,
  revisionHorizonBlock,
}: Props) {
  const [wanted, setWanted] = useState(0);
  const [comparing, setComparing] = useState(false);

  // Stable identity: the dialog's close listener is keyed on it.
  const stopComparing = useCallback(() => setComparing(false), []);

  // The horizon can shrink under a selection — 72 h with Day 3 in view, then
  // 24 h. `resolveDay` falls back to today, so the rendered day is always one
  // the current horizon actually offers.
  const selected = resolveDay(days, wanted);
  const scheduleMap = schedule ? new Map(schedule) : undefined;
  const canCompare = days.length > 1;

  // Today is the only day with an elapsed past, a revision gate and a declared
  // schedule. Drawing any of those on a future day would assert a deadline or a
  // declaration that does not exist.
  const isToday = selected.offset === 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-[var(--gridline)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <DaySelector days={days} selected={selected.offset} onSelect={setWanted} />
          <span className="text-11 text-ink-muted tabular-nums">
            {despatchDateLabel(selected.date)} · {selected.blocks.length} blocks
          </span>
        </div>

        {/* Hidden at 24 h rather than disabled. There is nothing to compare
            against on a one-day horizon, and a permanently dead button teaches
            the reader to ignore that corner of the panel. */}
        {canCompare && (
          <button
            type="button"
            onClick={() => setComparing(true)}
            className="btn-secondary text-11"
          >
            Compare days
          </button>
        )}
      </div>

      {/* Keyed by date so React swaps the subtree and the animation restarts.
          Without the key the fan would morph between two unrelated days. */}
      <div key={selected.date} className="rc-day-swap px-4 pb-4 pt-5">
        <ForecastChart
          blocks={selected.blocks}
          capacityMw={site.capacity_mw}
          evacuationMw={site.evacuation_limit_mw}
          revisionHorizonBlock={isToday ? revisionHorizonBlock : undefined}
          currentBlock={isToday ? currentBlock : undefined}
          scheduleMw={isToday ? scheduleMap : undefined}
          technology={site.technology}
        />
      </div>

      {comparing && (
        <CompareDialog
          days={days}
          site={site}
          schedule={scheduleMap}
          onClose={stopComparing}
        />
      )}
    </>
  );
}

/* ── Day selector ────────────────────────────────────────────────────────
   Only the days the horizon allows. A greyed-out "Day 3" at a 24 h horizon
   would be an invitation to a click that cannot work; the honest control shows
   what is available and grows when the window does. */

function DaySelector({
  days,
  selected,
  onSelect,
}: {
  days: ForecastDay[];
  selected: number;
  onSelect: (offset: number) => void;
}) {
  // One day is not a choice. At a 24 h horizon the label alone is the answer.
  if (days.length === 1) {
    return <span className="text-11 font-medium text-ink-secondary">Today</span>;
  }

  return (
    <div
      role="group"
      aria-label="Despatch day"
      className="inline-flex items-center overflow-hidden rounded-control border border-[var(--ring)]"
    >
      {days.map((day) => {
        const active = day.offset === selected;
        return (
          <button
            key={day.offset}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(day.offset)}
            className="border-r border-[var(--gridline)] px-2.5 py-1 text-11 font-medium last:border-r-0 active:scale-[0.98] transition-all duration-150"
            style={
              active
                ? { background: "var(--ink-primary)", color: "var(--surface)" }
                : { color: "var(--ink-secondary)" }
            }
          >
            {day.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Compare ─────────────────────────────────────────────────────────────
   The analytical view, deliberately behind a click. */

function CompareDialog({
  days,
  site,
  schedule,
  onClose,
}: {
  days: ForecastDay[];
  site: Site;
  schedule?: Map<number, number>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  const [a, setA] = useState(days[0].offset);
  const [b, setB] = useState(days[1].offset);

  // One hover position, both charts. The whole point of the side-by-side is
  // "what is different about this block", so the block has to be shared — two
  // independent hovers would make the reader hold a number in their head while
  // hunting for its twin.
  const [hoverBlock, setHoverBlock] = useState<number | null>(null);

  // A native dialog for the focus trap, the Escape key and the inert
  // background, none of which are worth reimplementing.
  //
  // The close listener is attached here rather than through React's `onClose`
  // prop: Escape closes the dialog in the platform, and if that close does not
  // reach React the component stays mounted with `comparing` still true — the
  // dialog is then invisible and the Compare button does nothing, because
  // setting a state that is already true re-runs no effect. Verified: that is
  // exactly what happened before this listener existed.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Guarded: the effect re-runs if the handler identity changes, and
    // `showModal` on an already-open dialog is not something to rely on.
    if (!node.open) node.showModal();
    node.addEventListener("close", onClose);
    return () => {
      node.removeEventListener("close", onClose);
      if (node.open) node.close();
    };
  }, [onClose]);

  const dayA = resolveDay(days, a);
  const dayB = resolveDay(days, b);

  // A day cannot be compared with itself, so picking the other side's day
  // swaps rather than refusing. Refusing would leave the reader holding a
  // select that ignored them.
  function pickA(next: number) {
    if (next === b) setB(a);
    setA(next);
  }
  function pickB(next: number) {
    if (next === a) setA(b);
    setB(next);
  }

  // One scale for both charts.
  //
  // This is the whole reason the comparison is trustworthy. Two charts each
  // scaled to their own maximum would show a 900 MW day and a 1,400 MW day as
  // the same height, and the reader would conclude they were alike. Shared
  // ceiling, shared ticks, identical dimensions: the difference in the ink is
  // the difference in the megawatts.
  const ceilingMw =
    Math.max(
      site.evacuation_limit_mw,
      ...dayA.blocks.map((x) => x.p90),
      ...dayB.blocks.map((x) => x.p90),
    ) * 1.06;

  return (
    <dialog
      ref={ref}
      // Escape fires `cancel` before the platform closes the dialog. Calling
      // `onClose` here rather than relying on the `close` event that follows
      // keeps React's state the single source of truth: if the dialog closed
      // in the platform but `comparing` stayed true, the component would sit
      // mounted and invisible and the Compare button would do nothing.
      onCancel={onClose}
      aria-labelledby="compare-heading"
      className="m-auto max-h-[92vh] w-[min(1360px,94vw)] overflow-y-auto rounded-modal border border-[var(--ring)] bg-surface p-0 text-ink-primary backdrop:bg-black/45"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--gridline)] px-4 py-3">
        <h2 id="compare-heading" className="text-14 font-semibold">
          Compare forecast days
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="btn-secondary text-11"
        >
          Close
        </button>
      </header>

      <Delta dayA={dayA} dayB={dayB} />

      <div className="grid grid-cols-1 gap-x-5 gap-y-6 px-4 py-4 lg:grid-cols-2">
        <Side
          label="Day A"
          day={dayA}
          days={days}
          onPick={pickA}
          site={site}
          ceilingMw={ceilingMw}
          schedule={schedule}
          hoverBlock={hoverBlock}
          onHoverBlock={setHoverBlock}
        />
        <Side
          label="Day B"
          day={dayB}
          days={days}
          onPick={pickB}
          site={site}
          ceilingMw={ceilingMw}
          schedule={schedule}
          hoverBlock={hoverBlock}
          onHoverBlock={setHoverBlock}
        />
      </div>

      <p className="border-t border-[var(--gridline)] px-4 py-3 text-11 text-ink-muted">
        Both charts share one 96-block spine, one megawatt scale and one set of
        ticks, so a difference in height is a difference in output. Hovering a
        block marks the same block on both days. Deltas are Day B minus Day A,
        aggregated from the same forecast values plotted above.
      </p>
    </dialog>
  );
}

/** One side of the comparison: its selector, then its chart. */
function Side({
  label,
  day,
  days,
  onPick,
  site,
  ceilingMw,
  schedule,
  hoverBlock,
  onHoverBlock,
}: {
  label: string;
  day: ForecastDay;
  days: ForecastDay[];
  onPick: (offset: number) => void;
  site: Site;
  ceilingMw: number;
  schedule?: Map<number, number>;
  hoverBlock: number | null;
  onHoverBlock: (block: number | null) => void;
}) {
  const selectId = `compare-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={selectId} className="text-11 font-medium text-ink-muted">
          {label}
        </label>
        <select
          id={selectId}
          value={day.offset}
          onChange={(e) => onPick(Number(e.target.value))}
          className="h-7 rounded-control border border-[var(--ring)] bg-surface px-2 text-11 font-medium text-ink-primary"
        >
          {days.map((d) => (
            <option key={d.offset} value={d.offset}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="text-11 text-ink-muted tabular-nums">
          {despatchDateLabel(day.date)}
        </span>
      </div>

      <ForecastChart
        blocks={day.blocks}
        capacityMw={site.capacity_mw}
        evacuationMw={site.evacuation_limit_mw}
        revisionHorizonBlock={undefined}
        currentBlock={undefined}
        scheduleMw={day.offset === 0 ? schedule : undefined}
        technology={site.technology}
        ceilingMw={ceilingMw}
        date={day.date}
        hoverBlock={hoverBlock}
        onHoverBlock={onHoverBlock}
      />
    </section>
  );
}

/* ── The delta strip ─────────────────────────────────────────────────────
   Four differences, every one an aggregation of the values already plotted
   above: sums and maxima of the same P10/P50/P90 the backend returned. No
   forecast is recomputed here, and nothing is modelled — if a figure could not
   be derived from the blocks on screen, it is not in this strip. */

function Delta({ dayA, dayB }: { dayA: ForecastDay; dayB: ForecastDay }) {
  const a = summarise(dayA.blocks);
  const b = summarise(dayB.blocks);

  const energyDelta = b.energyMwh - a.energyMwh;
  const peakDelta = b.peak.p50 - a.peak.p50;

  // Block index difference is exact quarter-hours, which is the only honest
  // resolution for a peak time: the peak is a block, not an instant.
  const peakShiftBlocks = b.peak.block - a.peak.block;
  const widthDelta = b.meanWidthMw - a.meanWidthMw;

  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-b border-[var(--gridline)] px-4 py-4 sm:grid-cols-4">
      <Metric
        label="Expected energy"
        value={signedMwh(energyDelta)}
        note={`${mwh(a.energyMwh)} → ${mwh(b.energyMwh)}`}
        delta={energyDelta}
      />
      <Metric
        label="Peak median"
        value={signedMw(peakDelta)}
        note={`${mw(a.peak.p50)} → ${mw(b.peak.p50)}`}
        delta={peakDelta}
      />
      <Metric
        label="Peak time"
        value={shift(peakShiftBlocks)}
        note={`${blockStartLabel(a.peak.block)} → ${blockStartLabel(b.peak.block)}`}
      />
      <Metric
        label="Mean uncertainty"
        // Halved to match the ± in the note and in the chart's own readout.
        // A headline in full band width beside a note in half width reads as
        // two different numbers disagreeing.
        value={signedMw(widthDelta / 2)}
        note={`±${mw(a.meanWidthMw / 2)} → ±${mw(b.meanWidthMw / 2)}`}
        // Wider is worse, so the sign is inverted against the colour.
        delta={-widthDelta}
      />
    </dl>
  );
}

function Metric({
  label,
  value,
  note,
  delta,
}: {
  label: string;
  value: string;
  note: string;
  delta?: number;
}) {
  const color =
    delta === undefined || Math.abs(delta) < 0.5
      ? undefined
      : delta > 0
        ? "var(--delta-pos)"
        : "var(--delta-neg)";

  return (
    <div>
      <dt className="text-11 font-medium text-ink-muted">{label}</dt>
      <dd
        className="mt-1 text-17 font-semibold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </dd>
      <p className="mt-1 text-11 text-ink-muted tabular-nums">{note}</p>
    </div>
  );
}

/** Sums and maxima of the plotted values. Nothing modelled. */
function summarise(blocks: ForecastBlock[]) {
  // MW to MWh is ÷4 because a block is a quarter hour — the same conversion
  // the day panel uses, and the only arithmetic in this file.
  const energyMwh = blocks.reduce((s, x) => s + x.p50, 0) / 4;
  const peak = blocks.reduce((best, x) => (x.p50 > best.p50 ? x : best), blocks[0]);
  const meanWidthMw = blocks.reduce((s, x) => s + (x.p90 - x.p10), 0) / blocks.length;

  return { energyMwh, peak, meanWidthMw };
}

function signedMwh(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${mwh(Math.abs(value))}`;
}

/** A peak-time difference in hours and minutes, signed. */
function shift(blocks: number): string {
  if (blocks === 0) return "Same block";

  const minutes = Math.abs(blocks) * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const span = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;

  return `${blocks > 0 ? "+" : "−"}${span}`;
}
