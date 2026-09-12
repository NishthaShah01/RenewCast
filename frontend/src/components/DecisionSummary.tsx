import { ACTION_LABELS, inr, mw, mwh, tonnes } from "@/lib/format";
import type { DecisionResponse } from "@/lib/types";

import { StatusDot, riskToStatus, type StatusLevel } from "./ui";

/**
 * The plan in four lines.
 *
 * The technical view below answers everything an operator could ask. This
 * answers the four things they ask first — what is happening, what to do, why,
 * and what it costs — so the page can be read in ten seconds and then studied.
 * It replaces nothing: the 96-block table, the merit order and the deviation
 * strip are all still below, unchanged.
 *
 * ## Every figure here was computed by the backend
 *
 * Not one number is derived in this component. The headline, the rationale,
 * the worst block, the magnitudes, the cost and the CO2 all arrive as fields
 * on the decisions response. What this does is *select* — the first actionable
 * action, the worst block — and format. A second implementation of the pricing
 * or the energy conversion living in a summary card is exactly how a summary
 * starts disagreeing with the table beneath it.
 *
 * ## Where a value is missing, the line says so
 *
 * A plan with nothing to do is a real and good outcome, not an empty state to
 * be filled with a placeholder. When there is no actionable run, the recommend
 * and impact lines say what is true instead of showing a zero.
 */
export function DecisionSummary({ decisions }: { decisions: DecisionResponse }) {
  // Selection, not calculation. `actions` arrives sorted actionable-first,
  // then by absolute financial weight, so the first actionable entry is the
  // backend's own top recommendation — not a re-ranking done here.
  const lead = decisions.actions.find((a) => a.actionable);

  // The worst block's own risk, for the status mark. `worst_block` is a block
  // number; this finds the row the backend already assessed.
  //
  // It is the largest absolute deviation of the day, so it is populated even on
  // a day that is entirely on plan. Presence alone therefore means nothing —
  // the risk the backend assigned that block is what decides whether this reads
  // "Action needed" or "Status".
  const worst = decisions.worst_block
    ? decisions.blocks.find((b) => b.block === decisions.worst_block)
    : undefined;
  const alert = worst && worst.risk !== "good" ? worst : undefined;

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-baseline justify-between gap-4 border-b border-[var(--gridline)] px-4 py-3">
        <h2 className="text-14 font-semibold">Summary</h2>
        <span className="text-11 text-ink-muted">Detail below</span>
      </header>

      <dl className="divide-y divide-[var(--gridline)]">
        <Line
          term={alert ? "Action needed" : "Status"}
          status={alert ? riskToStatus(alert.risk) : "good"}
        >
          {decisions.headline}
        </Line>

        <Line term="Recommended">
          {lead ? (
            <>
              {ACTION_LABELS[lead.action] ?? lead.action}
              <span className="text-ink-secondary">
                {" · "}
                {lead.label} ·{" "}
                {lead.block_start === lead.block_end ? (
                  <>block {lead.block_start}</>
                ) : (
                  <>
                    blocks {lead.block_start}&ndash;{lead.block_end}
                  </>
                )}
              </span>
            </>
          ) : (
            <span className="text-ink-secondary">
              No action available. Every run the plan identified sits inside the
              locked window, or the schedule holds for the rest of the day.
            </span>
          )}
        </Line>

        <Line term="Why">
          <span className="text-ink-secondary">
            {lead ? lead.rationale : decisions.schedule_basis}
          </span>
        </Line>

        <Line term="Impact">
          {lead ? (
            <Impact
              magnitudeMw={lead.magnitude_mw}
              energyMwh={lead.energy_mwh}
              costInr={lead.cost_inr}
              co2Tonnes={lead.co2_tonnes}
            />
          ) : (
            <DayImpact decisions={decisions} />
          )}
        </Line>
      </dl>
    </section>
  );
}

/* ── One question, one answer ─────────────────────────────────────────────
   A description list, not a card grid: these are four answers to four
   questions, which is what a `dl` is for, and it reads top-to-bottom in a
   screen reader in the same order it reads on screen. */

function Line({
  term,
  status,
  children,
}: {
  term: string;
  status?: StatusLevel;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="flex shrink-0 items-center gap-2 text-11 font-medium text-ink-muted sm:w-28 sm:pt-0.5">
        {status ? <StatusDot level={status} /> : null}
        {term}
      </dt>
      <dd className="max-w-[86ch] text-14">{children}</dd>
    </div>
  );
}

/* ── Impact ──────────────────────────────────────────────────────────────
   The lead action's own four figures, each straight off the response. Cost
   and CO2 carry their direction in words because a minus sign is far too
   quiet a way to say "this earns money" or "this avoids emissions". */

function Impact({
  magnitudeMw,
  energyMwh,
  costInr,
  co2Tonnes,
}: {
  magnitudeMw: number;
  energyMwh: number;
  costInr: number;
  co2Tonnes: number;
}) {
  return (
    <span className="tabular-nums">
      {mw(magnitudeMw)}
      <Sep />
      {mwh(energyMwh)}
      <Sep />
      <span style={{ color: costInr < 0 ? "var(--delta-pos)" : "var(--delta-neg)" }}>
        {inr(Math.abs(costInr))} {costInr < 0 ? "saved" : "spent"}
      </span>
      <Sep />
      <span style={{ color: co2Tonnes < 0 ? "var(--delta-pos)" : undefined }}>
        {tonnes(Math.abs(co2Tonnes))} {co2Tonnes < 0 ? "avoided" : "emitted"}
      </span>
    </span>
  );
}

/** The day's totals, when there is no single action to price. */
function DayImpact({ decisions }: { decisions: DecisionResponse }) {
  return (
    <span className="tabular-nums">
      <span style={{ color: decisions.net_cost_inr < 0 ? "var(--delta-pos)" : undefined }}>
        {inr(Math.abs(decisions.net_cost_inr))}{" "}
        {decisions.net_cost_inr < 0 ? "saved" : "additional cost"} across the day
      </span>
      <Sep />
      {mwh(decisions.deficit_energy_mwh)} shortfall risk
      <Sep />
      {mwh(decisions.curtailment_energy_mwh)} curtailment
    </span>
  );
}

function Sep() {
  return (
    <span className="mx-2 text-ink-muted" aria-hidden>
      ·
    </span>
  );
}
