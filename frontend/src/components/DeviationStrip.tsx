import { BLOCKS_PER_DAY, blockStartLabel } from "@/lib/blocks";
import { mw } from "@/lib/format";
import type { BlockDecision } from "@/lib/types";

/**
 * Deviation across the despatch day, on the 96-block spine.
 *
 * Diverging scale, neutral at zero: the question is not "how much" but "which
 * side", and a sequential ramp answers the wrong one. Curtailment is drawn in
 * the critical colour regardless of magnitude — energy above the evacuation
 * limit is not a deviation to be traded off, it is generation that cannot
 * physically leave the site.
 *
 * Square cells, no gaps beyond the 1px seam: this is a grid, and a rounded
 * corner on a grid cell fights the grid.
 */
export function DeviationStrip({
  blocks,
  horizonBlock,
  currentBlock,
}: {
  blocks: BlockDecision[];
  horizonBlock: number;
  currentBlock: number;
}) {
  const scale = Math.max(
    1,
    ...blocks.map((b) => Math.abs(b.deviation_mw)),
  );

  const tickBlocks = blocks.filter((b) => (b.block - 1) % 8 === 0);

  return (
    <div className="grid grid-cols-[168px_1fr_104px] items-center gap-4">
      <span className="text-12 font-medium text-ink-secondary">
        Deviation from plan
      </span>

      <div>
        <div
          className="flex h-8 w-full gap-px"
          role="img"
          aria-label={describe(blocks)}
        >
          {blocks.map((b) => (
            <span
              key={b.block}
              title={`${b.label} · ${b.deviation_mw > 0 ? "+" : ""}${mw(b.deviation_mw)}`}
              className="flex-1"
              style={{
                background: colorFor(b, scale),
                opacity: b.locked ? 0.55 : 1,
                // Now and the horizon get a top rule rather than a fill, so
                // the deviation colour underneath stays readable.
                boxShadow:
                  b.block === currentBlock
                    ? "inset 0 2px 0 var(--ink-primary)"
                    : b.block === horizonBlock
                      ? "inset 0 2px 0 var(--series-1)"
                      : undefined,
              }}
            />
          ))}
        </div>

        <div className="relative mt-1 h-4">
          {tickBlocks.map((b) => (
            <span
              key={b.block}
              className="absolute font-condensed text-11 text-ink-muted tabular-nums"
              style={{
                left: `${((b.block - 1) / BLOCKS_PER_DAY) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              {blockStartLabel(b.block)}
            </span>
          ))}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-11 text-ink-secondary">
          <Key color="var(--seq-450)">Under-declared</Key>
          <Key color="var(--diverge-mid)">On plan</Key>
          <Key color="var(--series-2)">Over-declared</Key>
          <Key color="var(--status-critical)">Curtailment</Key>
        </ul>
      </div>

      <span className="self-start text-11 text-ink-muted tabular-nums">
        ±{mw(scale)} full scale
      </span>
    </div>
  );
}

function colorFor(b: BlockDecision, scale: number): string {
  if (b.curtailment_mw > 0) return "var(--status-critical)";

  const t = Math.min(Math.abs(b.deviation_mw) / scale, 1);
  if (t < 0.08) return "var(--diverge-mid)";

  // Two arms from the neutral midpoint. Over-declaring is the side that costs
  // money under DSM, so it takes the warm arm that reads as a warning.
  return b.deviation_mw > 0
    ? `color-mix(in oklab, var(--series-2) ${Math.round(t * 100)}%, var(--diverge-mid))`
    : `color-mix(in oklab, var(--seq-450) ${Math.round(t * 100)}%, var(--diverge-mid))`;
}

function Key({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="h-[2px] w-4 shrink-0" style={{ background: color }} />
      {children}
    </li>
  );
}

function describe(blocks: BlockDecision[]): string {
  const over = blocks.filter((b) => b.deviation_mw > 0).length;
  const curtailed = blocks.filter((b) => b.curtailment_mw > 0).length;
  return (
    `Deviation from the declared schedule across ${blocks.length} blocks. ` +
    `${over} blocks are declared above the median forecast. ` +
    `${curtailed} blocks exceed the evacuation limit.`
  );
}
