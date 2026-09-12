/**
 * Despatch days inside one forecast response.
 *
 * The forecast starts at block 1 of today and runs to `issued + horizon`, so
 * the response always ends mid-day: a 24 h window issued at 11:00 returns
 * today's 96 blocks plus 45 of tomorrow's. Those trailing blocks extend the
 * window, but they are not a day you can read a despatch plan off.
 *
 * So the selector offers whole days only — `horizon / 24` of them. 24 h is
 * today, 48 h adds tomorrow, 72 h adds the day after. The partial tail stays in
 * the payload and out of the control.
 */

import type { ForecastBlock } from "@/lib/types";

import { BLOCKS_PER_DAY } from "./blocks";
import type { Horizon } from "./horizon";

export interface ForecastDay {
  /** `'2026-09-12'`. The despatch date these blocks belong to. */
  date: string;
  /** 0 is today, 1 tomorrow, 2 the day after. */
  offset: number;
  /** `'Today'`, `'Tomorrow'`, `'Day 3'`. */
  label: string;
  blocks: ForecastBlock[];
}

/** How many whole days a horizon can show. 24 h → 1, 48 h → 2, 72 h → 3. */
export function daysForHorizon(horizon: Horizon): number {
  return horizon / 24;
}

function labelFor(offset: number): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return `Day ${offset + 1}`;
}

/**
 * Split a forecast into the whole days the horizon entitles it to.
 *
 * Grouping is by the date in the timestamp, not by arithmetic on the block
 * index, because the timestamps are the backend's own IST dates — recomputing
 * the day boundary here would be a second implementation of the thing
 * `blocks.ts` exists to keep singular.
 */
export function splitDays(
  blocks: ForecastBlock[],
  despatchDate: string,
  horizon: Horizon,
): ForecastDay[] {
  const byDate = new Map<string, ForecastBlock[]>();
  for (const b of blocks) {
    const date = b.timestamp.slice(0, 10);
    const list = byDate.get(date);
    if (list) list.push(b);
    else byDate.set(date, [b]);
  }

  const dates = [...byDate.keys()].sort();
  const start = dates.indexOf(despatchDate);
  const ordered = start === -1 ? dates : dates.slice(start);

  const wanted = daysForHorizon(horizon);
  const days: ForecastDay[] = [];

  for (let offset = 0; offset < ordered.length && days.length < wanted; offset++) {
    const date = ordered[offset];
    const dayBlocks = byDate.get(date)!;
    // A short day is the partial tail of the window. Today is exempt: the
    // window opens at block 1, so today is always whole.
    if (offset > 0 && dayBlocks.length < BLOCKS_PER_DAY) continue;
    days.push({ date, offset, label: labelFor(offset), blocks: dayBlocks });
  }

  return days;
}

/** Clamp a chosen day to one the current horizon still offers. */
export function resolveDay(days: ForecastDay[], offset: number): ForecastDay {
  return days.find((d) => d.offset === offset) ?? days[0];
}
