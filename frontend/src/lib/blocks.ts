/**
 * Time-block arithmetic — the keystone of the whole UI.
 *
 * The Indian despatch day is 96 blocks of 15 minutes, beginning 00:00 IST.
 * Every chart in RenewCast is laid out as a 96-column spine, so this module
 * decides where every mark lands.
 *
 * It is an exact mirror of the backend's `app/core/timeblocks.py`. If the two
 * disagree, the bands drift out of alignment and the entire design premise
 * collapses. `scripts/check-blocks.ts` asserts the same cases as the Python
 * test suite; run it after touching either side.
 *
 * On timezones: India observes no daylight saving, so IST is a fixed +5:30
 * offset. That lets us do the arithmetic by shifting the instant and reading
 * UTC components — no Intl, no tz database, and identical results on a
 * developer's laptop in any timezone and on a server running UTC.
 */

export const BLOCKS_PER_DAY = 96;
export const BLOCK_MINUTES = 15;
export const IST_OFFSET_MINUTES = 330;

/** A voluntary schedule revision takes effect from the 6th time block. */
export const VOLUNTARY_REVISION_LEAD_BLOCKS = 6;
/** An RLDC-initiated revision takes effect from the 4th. */
export const RLDC_REVISION_LEAD_BLOCKS = 4;

const MS_PER_MINUTE = 60_000;

/** IST wall-clock fields for an instant. */
interface IstParts {
  year: number;
  month: number; // 0-indexed, matching Date
  day: number;
  hour: number;
  minute: number;
}

function istParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** The UTC instant for an IST wall-clock time. */
function fromIst(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(
    Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MINUTES * MS_PER_MINUTE,
  );
}

function assertBlock(block: number): void {
  if (!Number.isInteger(block) || block < 1 || block > BLOCKS_PER_DAY) {
    throw new RangeError(`block must be an integer 1..${BLOCKS_PER_DAY}, got ${block}`);
  }
}

/**
 * Block index (1..96) containing `date`.
 *
 * Blocks are half-open: 00:15 belongs to block 2, not block 1.
 */
export function blockOf(date: Date): number {
  const { hour, minute } = istParts(date);
  return Math.floor((hour * 60 + minute) / BLOCK_MINUTES) + 1;
}

/** Start instant of `block` on the despatch day containing `date`. */
export function blockStart(date: Date, block: number): Date {
  assertBlock(block);
  const { year, month, day } = istParts(date);
  return new Date(
    fromIst(year, month, day).getTime() + (block - 1) * BLOCK_MINUTES * MS_PER_MINUTE,
  );
}

/** End instant of `block` — identical to the start of `block + 1`. */
export function blockEnd(date: Date, block: number): Date {
  return new Date(blockStart(date, block).getTime() + BLOCK_MINUTES * MS_PER_MINUTE);
}

/**
 * Human label for a block, e.g. `'10:30–10:45'`.
 *
 * Block 96 ends at 24:00, rendered as such rather than 00:00 so the despatch
 * day reads as a closed interval. The separator is an en dash, matching the
 * backend byte for byte.
 */
export function blockLabel(block: number): string {
  assertBlock(block);
  const startMin = (block - 1) * BLOCK_MINUTES;
  const endMin = startMin + BLOCK_MINUTES;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}` +
    `–${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`
  );
}

/** Just the start time of a block, e.g. `'10:30'` — for axis ticks. */
export function blockStartLabel(block: number): string {
  assertBlock(block);
  const startMin = (block - 1) * BLOCK_MINUTES;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`;
}

/**
 * First block a schedule revision issued now can still affect.
 *
 * Everything to the left of this is locked — no amount of forecast accuracy
 * can change it, which is why the UI dims it to 55% and labels it "Locked".
 *
 * Saturates at 96 rather than rolling into tomorrow: the despatch day is the
 * unit of scheduling.
 */
export function revisionHorizonBlock(
  date: Date = new Date(),
  { voluntary = true }: { voluntary?: boolean } = {},
): number {
  const lead = voluntary ? VOLUNTARY_REVISION_LEAD_BLOCKS : RLDC_REVISION_LEAD_BLOCKS;
  return Math.min(blockOf(date) + lead, BLOCKS_PER_DAY);
}

/**
 * The four blocks spanned by an hour-of-day, inclusive.
 *
 * Weather arrives hourly; schedules are per block. Hour 0 covers blocks 1–4.
 */
export function hourToBlocks(hour: number): [number, number] {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`hour must be an integer 0..23, got ${hour}`);
  }
  const first = hour * 4 + 1;
  return [first, first + 3];
}

/** Hour-of-day containing `block`, for joining against hourly weather. */
export function blockToHour(block: number): number {
  assertBlock(block);
  return Math.floor((block - 1) / 4);
}

/** Number of whole 15-minute blocks between two instants. */
export function blocksBetween(start: Date, end: Date): number {
  return Math.floor(
    (end.getTime() - start.getTime()) / (BLOCK_MINUTES * MS_PER_MINUTE),
  );
}

/** Despatch date as `YYYY-MM-DD` in IST — the key the API uses. */
export function despatchDate(date: Date = new Date()): string {
  const { year, month, day } = istParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** `'14:23 IST'` — for the block clock in the global chrome. */
export function formatIst(date: Date): string {
  const { hour, minute } = istParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)} IST`;
}

/**
 * All 96 blocks as `{ block, label, start }`.
 *
 * Built once and memoised per despatch date: the spine renders this array on
 * every view, and rebuilding 96 Date objects per render is waste the charts
 * would feel.
 */
export interface BlockTick {
  block: number;
  label: string;
  startLabel: string;
  start: Date;
}

const dayCache = new Map<string, readonly BlockTick[]>();

export function blocksForDay(date: Date = new Date()): readonly BlockTick[] {
  const key = despatchDate(date);
  const cached = dayCache.get(key);
  if (cached) return cached;

  const ticks: BlockTick[] = Array.from({ length: BLOCKS_PER_DAY }, (_, i) => {
    const block = i + 1;
    return {
      block,
      label: blockLabel(block),
      startLabel: blockStartLabel(block),
      start: blockStart(date, block),
    };
  });
  dayCache.set(key, ticks);
  return ticks;
}

/**
 * Whether a block is locked — before the revision horizon, so unchangeable.
 *
 * The single predicate behind the dimmed region. Expressed once here so a
 * chart, a table and a form can never disagree about what "locked" means.
 */
export function isLocked(block: number, horizonBlock: number): boolean {
  return block < horizonBlock;
}
