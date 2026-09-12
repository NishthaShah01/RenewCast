"use client";

import { useEffect, useState } from "react";

import { blockLabel, blockOf, revisionHorizonBlock } from "@/lib/blocks";

interface Now {
  block: number;
  label: string;
  horizon: number;
}

/**
 * The block clock.
 *
 * Not a wall clock. An operator's question is never "what time is it" but
 * "which block are we in, and which is the first one I can still change" —
 * so the display leads with the block number and carries the horizon beside
 * it. Everything before the horizon is already committed.
 *
 * Ticks every 10 seconds. A block lasts 15 minutes, so per-second updates
 * would be 90 renders to change one digit.
 */
export function BlockClock() {
  const [now, setNow] = useState<Now | null>(null);

  useEffect(() => {
    const read = () => {
      const date = new Date();
      setNow({
        block: blockOf(date),
        label: blockLabel(blockOf(date)),
        horizon: revisionHorizonBlock(date),
      });
    };
    read();
    const id = setInterval(read, 10_000);
    return () => clearInterval(id);
  }, []);

  // Rendered server-side and on first paint. The block depends on the
  // client's clock, so there is no honest value to show until mount; a
  // fixed-width placeholder holds the layout instead of shifting it.
  if (!now) {
    return <span className="text-12 text-ink-muted tabular-nums">—</span>;
  }

  return (
    <span className="flex items-baseline gap-2 text-12 tabular-nums">
      <span className="font-semibold text-ink-primary">Block {now.block}</span>
      <span className="text-ink-secondary">{now.label}</span>
      <span className="text-ink-muted">
        revisable from <span className="font-medium">{now.horizon}</span>
      </span>
    </span>
  );
}
