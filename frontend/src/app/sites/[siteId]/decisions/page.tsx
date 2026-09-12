import Link from "next/link";
import { notFound } from "next/navigation";

import { Copilot } from "@/components/Copilot";
import { DecisionSummary } from "@/components/DecisionSummary";
import { DeviationStrip } from "@/components/DeviationStrip";
import { Caveat, Panel, ServiceDown, Stat, StatusDot, Td, Th, riskToStatus } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  ACTION_LABELS,
  RISK_LABELS,
  cost,
  despatchDateLabel,
  inr,
  mw,
  mwh,
  signedMw,
  tonnes,
} from "@/lib/format";
import type { BlockDecision, DecisionResponse, RecommendedAction } from "@/lib/types";

/**
 * The despatch plan.
 *
 * This is the page the product exists for. A forecast is an observation; this
 * is the instruction that follows from it, priced and ordered by merit.
 *
 * Actions lead because that is what an operator acts on. The 96-block table is
 * below and filtered to blocks that need attention — 96 rows of "on plan" is
 * not information.
 */
export default async function DecisionsPage(
  props: PageProps<"/sites/[siteId]/decisions">,
) {
  const { siteId } = await props.params;

  let decisions: DecisionResponse;
  try {
    decisions = await api.decisions(siteId, 24);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <ServiceDown
        title="Despatch plan unavailable"
        message={error instanceof ApiError ? error.message : "The service didn't respond."}
        hint={error instanceof ApiError ? error.hint : undefined}
      />
    );
  }

  const site = decisions.site;
  const attention = decisions.blocks.filter(
    (b) => b.risk !== "good" || b.curtailment_mw > 0,
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <nav className="mb-2 text-11 text-ink-muted">
          <Link href="/" className="underline-offset-2 hover:underline">
            Fleet
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          <Link href={`/sites/${site.id}`} className="underline-offset-2 hover:underline">
            {site.name}
          </Link>
          <span className="mx-1.5" aria-hidden>/</span>
          <span>Despatch plan</span>
        </nav>

        <h1 className="text-24 font-semibold tracking-[-0.01em]">Despatch plan</h1>
      </div>

      {/* The plan in four lines, above the technical view it summarises. The
          headline used to sit under the h1; it is the summary's first line now,
          because printing the same sentence twice a hundred pixels apart reads
          as a bug. Everything below is untouched. */}
      <DecisionSummary decisions={decisions} />

      <Panel
        title="Today"
        meta={despatchDateLabel(decisions.despatch_date)}
        footnote="Cost is signed: positive is money spent, negative is money saved. Shortfall is measured against the P10 floor, surplus and curtailment against the P90 ceiling — the quantiles are not interchangeable."
      >
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
          <Stat
            label="Net cost of plan"
            value={inr(Math.abs(decisions.net_cost_inr))}
            tone={decisions.net_cost_inr < 0 ? "positive" : "negative"}
            note={decisions.net_cost_inr < 0 ? "Net saving" : "Net spend"}
          />
          <Stat
            label="Shortfall risk"
            value={mwh(decisions.deficit_energy_mwh)}
            note="Against P10"
          />
          <Stat
            label="Curtailment"
            value={mwh(decisions.curtailment_energy_mwh)}
            note={`Above ${mw(site.evacuation_limit_mw)} limit`}
            tone={decisions.curtailment_energy_mwh > 0 ? "negative" : undefined}
          />
          <Stat
            label="Net CO₂"
            value={tonnes(decisions.net_co2_tonnes)}
            tone={decisions.net_co2_tonnes < 0 ? "positive" : undefined}
            note={decisions.net_co2_tonnes < 0 ? "Avoided" : "Emitted"}
          />
        </dl>

        <div className="border-t border-[var(--gridline)] px-4 py-4">
          <DeviationStrip
            blocks={decisions.blocks}
            horizonBlock={decisions.revision_horizon_block}
            currentBlock={decisions.current_block}
          />
        </div>

        <div className="border-t border-[var(--gridline)] px-4 py-3">
          <Caveat>{decisions.schedule_basis}</Caveat>
        </div>
      </Panel>

      <Actions actions={decisions.actions} />

      <Copilot siteId={site.id} siteName={site.name} />

      <BlockTable blocks={attention} total={decisions.blocks.length} />
    </div>
  );
}

/* ── Actions ─────────────────────────────────────────────────────────────
   Merit order, actionable first. Cost carries its direction in words, not
   only in a minus sign. */

function Actions({ actions }: { actions: RecommendedAction[] }) {
  if (actions.length === 0) {
    return (
      <Panel title="Recommended actions">
        <p className="px-4 py-6 text-14 text-ink-secondary">
          Nothing to do. The declared schedule sits inside the forecast interval
          for every remaining block today.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Recommended actions"
      meta={`${actions.filter((a) => a.actionable).length} actionable`}
      footnote="Ordered by merit, then by value. Greyed rows fall entirely inside the locked window — kept on screen because they explain the deviation you are about to be charged for."
    >
      <table className="w-full text-14">
        <thead>
          <tr className="border-b border-[var(--gridline)]">
            <Th>Action</Th>
            <Th>Blocks</Th>
            <Th numeric>Magnitude</Th>
            <Th numeric>Energy</Th>
            <Th numeric>Cost</Th>
            <Th numeric>CO₂</Th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a, i) => {
            const money = cost(a.cost_inr);
            return (
              <tr
                key={`${a.action}-${a.block_start}-${i}`}
                className="border-b border-[var(--gridline)] align-top last:border-0"
                style={a.actionable ? undefined : { opacity: 0.55 }}
              >
                <Td>
                  <span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span>
                  {!a.actionable && (
                    <span className="ml-2 text-11 text-ink-muted">Locked</span>
                  )}
                  <p className="mt-0.5 max-w-[52ch] text-12 text-ink-secondary">
                    {a.rationale}
                  </p>
                </Td>
                <Td muted>
                  <span className="tabular-nums">{a.label}</span>
                  <span className="ml-2 text-11 text-ink-muted tabular-nums">
                    {a.block_start}–{a.block_end}
                  </span>
                </Td>
                <Td numeric>{mw(a.magnitude_mw)}</Td>
                <Td numeric>{mwh(a.energy_mwh)}</Td>
                <Td numeric>
                  <span
                    style={{ color: money.saving ? "var(--delta-pos)" : "var(--delta-neg)" }}
                  >
                    {money.saving ? "saves " : ""}
                    {money.text}
                  </span>
                </Td>
                <Td numeric muted>{tonnes(a.co2_tonnes)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/* ── Block detail ───────────────────────────────────────────────────────── */

function BlockTable({ blocks, total }: { blocks: BlockDecision[]; total: number }) {
  if (blocks.length === 0) {
    return (
      <Panel title="Blocks needing attention" meta={`0 of ${total}`}>
        <p className="px-4 py-6 text-14 text-ink-secondary">
          Every block today sits on plan. Nothing needs a revision.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Blocks needing attention"
      meta={`${blocks.length} of ${total}`}
      footnote="Deviation is the declared schedule minus the P50 forecast. Positive means the declaration is above the central estimate — the side that attracts a DSM charge."
    >
      <table className="w-full text-14">
        <thead>
          <tr className="border-b border-[var(--gridline)]">
            <Th>Block</Th>
            <Th>Risk</Th>
            <Th numeric>Declared</Th>
            <Th numeric>P50</Th>
            <Th numeric>Deviation</Th>
            <Th numeric>Shortfall</Th>
            <Th numeric>Curtailment</Th>
            <Th numeric>Headroom</Th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr
              key={b.block}
              className="border-b border-[var(--gridline)] last:border-0"
              style={b.locked ? { opacity: 0.55 } : undefined}
            >
              <Td>
                <span className="tabular-nums">{b.label}</span>
                <span className="ml-2 text-11 text-ink-muted tabular-nums">{b.block}</span>
              </Td>
              <Td>
                <span className="flex items-center gap-2">
                  <StatusDot level={riskToStatus(b.risk)} />
                  {RISK_LABELS[b.risk] ?? b.risk}
                </span>
              </Td>
              <Td numeric>{mw(b.schedule_mw)}</Td>
              <Td numeric muted>{mw(b.p50)}</Td>
              <Td numeric>
                <span
                  style={{
                    color: b.deviation_mw > 0 ? "var(--delta-neg)" : "var(--ink-secondary)",
                  }}
                >
                  {signedMw(b.deviation_mw)}
                </span>
              </Td>
              <Td numeric muted>{b.deficit_mw > 0 ? mw(b.deficit_mw) : "—"}</Td>
              <Td numeric>
                {b.curtailment_mw > 0 ? (
                  <span style={{ color: "var(--delta-neg)" }}>{mw(b.curtailment_mw)}</span>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </Td>
              <Td numeric muted>{signedMw(b.headroom_mw)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
