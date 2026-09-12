/**
 * Block-arithmetic parity check.
 *
 * These are the same cases as `backend/tests/test_timeblocks.py`. The two
 * implementations must agree exactly: the backend decides which block a
 * forecast value belongs to, the frontend decides where on the spine it is
 * drawn, and a disagreement misaligns every chart in the product.
 *
 * Run:  npm run check:blocks
 *
 * No test framework — Node 24 strips TypeScript types and ships a test
 * runner, so the parity check has zero dependencies and cannot rot when a
 * test library changes its API.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLOCKS_PER_DAY,
  blockEnd,
  blockLabel,
  blockOf,
  blockStart,
  blockToHour,
  blocksBetween,
  blocksForDay,
  despatchDate,
  formatIst,
  hourToBlocks,
  isLocked,
  revisionHorizonBlock,
} from "../src/lib/blocks.ts";

/** An IST instant on a fixed date, so tests never depend on today. */
function t(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 8, 12, hour, minute) - 330 * 60_000);
}

// ── blockOf ───────────────────────────────────────────────────────────────

test("blockOf maps IST wall-clock to block index", () => {
  const cases: [Date, number][] = [
    [t(0, 0), 1], // first instant of the despatch day
    [t(0, 14), 1], // still inside block 1 — blocks are half-open
    [t(0, 15), 2], // boundary belongs to the NEXT block
    [t(10, 30), 43],
    [t(12, 0), 49], // midday
    [t(23, 45), 96],
    [t(23, 59), 96], // last instant of the day
  ];
  for (const [moment, expected] of cases) {
    assert.equal(blockOf(moment), expected, `at ${moment.toISOString()}`);
  }
});

test("blockOf handles the UTC date rollover", () => {
  // IST is UTC+5:30, so midnight IST is 18:30 UTC on the PREVIOUS day. A
  // timestamp that looks like the 11th belongs to the despatch day of the
  // 12th; treating it as wall-clock shifts the day by 22 blocks.
  assert.equal(blockOf(new Date("2026-09-11T18:30:00Z")), 1);
  assert.equal(blockOf(new Date("2026-09-12T05:30:00Z")), 45); // 11:00 IST
});

// ── labels and boundaries ─────────────────────────────────────────────────

test("blockLabel matches the backend byte for byte", () => {
  assert.equal(blockLabel(1), "00:00–00:15");
  assert.equal(blockLabel(43), "10:30–10:45");
  // The day closes at 24:00, not 00:00, so the interval reads as closed.
  assert.equal(blockLabel(96), "23:45–24:00");
});

test("block boundaries are contiguous", () => {
  const day = t(9);
  for (let block = 1; block < BLOCKS_PER_DAY; block += 1) {
    assert.equal(
      blockEnd(day, block).getTime(),
      blockStart(day, block + 1).getTime(),
      `block ${block} end != block ${block + 1} start`,
    );
  }
});

test("block 1 starts at IST midnight regardless of the reference time", () => {
  assert.equal(formatIst(blockStart(t(17, 42), 1)), "00:00 IST");
});

test("out-of-range blocks throw", () => {
  for (const bad of [0, 97, -1, 1000, 1.5]) {
    assert.throws(() => blockLabel(bad), RangeError, `blockLabel(${bad})`);
    assert.throws(() => blockStart(t(9), bad), RangeError, `blockStart(${bad})`);
  }
});

// ── hour ↔ block ──────────────────────────────────────────────────────────

test("hourToBlocks", () => {
  assert.deepEqual(hourToBlocks(0), [1, 4]);
  assert.deepEqual(hourToBlocks(10), [41, 44]);
  assert.deepEqual(hourToBlocks(23), [93, 96]);
});

test("every block maps back into its hour", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    const [first, last] = hourToBlocks(hour);
    assert.equal(last - first, 3);
    for (let block = first; block <= last; block += 1) {
      assert.equal(blockToHour(block), hour);
    }
  }
});

test("bad hours throw", () => {
  for (const bad of [-1, 24]) {
    assert.throws(() => hourToBlocks(bad), RangeError);
  }
});

// ── revision horizon ──────────────────────────────────────────────────────

test("voluntary revision takes effect 6 blocks out", () => {
  assert.equal(revisionHorizonBlock(t(10, 30)), 43 + 6);
});

test("RLDC-initiated revision takes effect 4 blocks out", () => {
  assert.equal(revisionHorizonBlock(t(10, 30), { voluntary: false }), 43 + 4);
});

test("horizon saturates at end of day rather than rolling over", () => {
  assert.equal(revisionHorizonBlock(t(23, 50)), 96);
  assert.equal(revisionHorizonBlock(t(23, 0)), 96);
});

test("horizon is never behind the current block", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      const moment = t(hour, minute);
      assert.ok(revisionHorizonBlock(moment) >= blockOf(moment));
    }
  }
});

test("isLocked splits the day at the horizon", () => {
  const horizon = revisionHorizonBlock(t(10, 30)); // 49
  assert.equal(isLocked(48, horizon), true);
  assert.equal(isLocked(49, horizon), false); // the horizon block is actionable
  assert.equal(isLocked(96, horizon), false);
});

// ── durations and formatting ──────────────────────────────────────────────

test("blocksBetween", () => {
  assert.equal(blocksBetween(t(10, 0), t(11, 0)), 4);
  assert.equal(blocksBetween(t(0, 0), t(23, 45)), 95);
  assert.equal(blocksBetween(t(10, 0), t(10, 14)), 0);
});

test("despatchDate is the IST date, not the UTC one", () => {
  assert.equal(despatchDate(t(0, 5)), "2026-09-12");
  assert.equal(despatchDate(t(23, 55)), "2026-09-12");
  // 19:00 UTC on the 11th is already 00:30 IST on the 12th.
  assert.equal(despatchDate(new Date("2026-09-11T19:00:00Z")), "2026-09-12");
});

// ── the rendered spine ────────────────────────────────────────────────────

test("blocksForDay produces exactly 96 aligned ticks", () => {
  const ticks = blocksForDay(t(9));
  assert.equal(ticks.length, 96);
  assert.equal(ticks[0].block, 1);
  assert.equal(ticks[0].startLabel, "00:00");
  assert.equal(ticks[95].block, 96);
  assert.equal(ticks[95].label, "23:45–24:00");
  // Each tick's start must agree with blockOf — the round trip that keeps
  // marks on the spine where the data says they belong.
  for (const tick of ticks) {
    assert.equal(blockOf(tick.start), tick.block);
  }
});

test("blocksForDay is memoised per despatch date", () => {
  assert.equal(blocksForDay(t(3)), blocksForDay(t(20)));
});
