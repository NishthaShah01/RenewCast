import Link from "next/link";

import { Caveat, Panel, ServiceDown, Stat, Td, Th } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { percent, technologyLabel } from "@/lib/format";
import type { AccuracyResponse, TechnologyAccuracy } from "@/lib/types";

/**
 * Model accuracy.
 *
 * The page states what the model is worth against the honest baseline — Stage
 * A physics alone — rather than quoting an MAE that would look impressive next
 * to no baseline at all. It also states where the model is weaker than
 * nominal, because a metrics page that only reports flattering numbers is
 * marketing.
 */
export default async function AccuracyPage() {
  let data: AccuracyResponse;
  try {
    data = await api.accuracy();
  } catch (error) {
    return (
      <ServiceDown
        title="No accuracy metrics"
        message={error instanceof ApiError ? error.message : "The service didn't respond."}
        hint={error instanceof ApiError ? error.hint : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <nav className="mb-2 text-11 text-ink-muted">
          <Link href="/" className="underline-offset-2 hover:underline">Fleet</Link>
          <span className="mx-1.5" aria-hidden>/</span>
          <span>Accuracy</span>
        </nav>
        <h1 className="text-24 font-semibold tracking-[-0.01em]">Model accuracy</h1>
        <p className="mt-1 max-w-[80ch] text-14 text-ink-secondary">
          Validation metrics on a held-out split, measured against archived
          forecast weather at four lead times — so the error growth with lead
          time is the real thing, not an artefact of reanalysis.
        </p>
      </div>

      {data.technologies.map((t) => (
        <TechnologyPanel key={t.technology} t={t} />
      ))}

      <Panel title="How these were produced" meta={`v${data.model_version}`}>
        <div className="flex flex-col gap-3 px-4 py-4 text-14 text-ink-secondary">
          <p className="max-w-[86ch]">
            Two stages. Stage A is deterministic physics — clear-sky irradiance
            and a real turbine power curve. Stage B is gradient-boosted quantile
            regression that predicts the <em>residual</em> in capacity-factor
            terms, at three quantiles.
          </p>
          <p className="max-w-[86ch]">
            No target lags are used as features. A model given yesterday&rsquo;s
            output would score beautifully in validation and be useless at a
            72-hour horizon, where no recent actuals exist. This is enforced by
            a test, not by convention.
          </p>
          <Caveat>
            Ground truth is {data.ground_truth}. The physics and the weather are
            real; the plant&rsquo;s measured response is modelled, because
            block-level metered output for these sites is not public. Treat the
            error figures as a bound on the method, not as a field-validated
            claim about these specific plants.
          </Caveat>
        </div>
      </Panel>
    </div>
  );
}

function TechnologyPanel({ t }: { t: TechnologyAccuracy }) {
  // Coverage error in points. Wider than nominal is conservative; narrower is
  // overconfident, and only one of those is a problem for an operator.
  const coverageError = t.pi_coverage - t.pi_nominal;
  const conservative = coverageError > 0;

  return (
    <Panel
      title={technologyLabel(t.technology)}
      meta={`${t.rows_train.toLocaleString("en-IN")} training rows · ${t.n_features} features`}
      footnote={
        conservative
          ? `Intervals are wider than nominal by ${(coverageError * 100).toFixed(1)} points — conservative, so an operator planning against P10 is covered slightly more often than advertised.`
          : `Intervals are narrower than nominal by ${(Math.abs(coverageError) * 100).toFixed(1)} points — mildly overconfident. Plan against P10 with that in mind.`
      }
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-4">
        <Stat
          label="Skill over physics"
          value={`${t.skill_pct.toFixed(1)}%`}
          tone="positive"
          note="The only honest measure of what ML adds"
        />
        <Stat
          label="nMAE"
          value={`${t.nmae_pct.toFixed(2)}%`}
          note={`${t.nmae_pct_physics.toFixed(2)}% physics alone`}
        />
        <Stat
          label="Interval coverage"
          value={percent(t.pi_coverage)}
          status={Math.abs(coverageError) < 0.05 ? "good" : "warning"}
          note={`${percent(t.pi_nominal, 0)} nominal`}
        />
        <Stat
          label="Mean interval width"
          value={`${t.mean_interval_width_mw.toFixed(0)} MW`}
          note="P10 to P90"
        />
      </dl>

      <table className="w-full border-t border-[var(--gridline)] text-14">
        <thead>
          <tr className="border-b border-[var(--gridline)]">
            <Th>Metric</Th>
            <Th numeric>Two-stage</Th>
            <Th numeric>Physics only</Th>
            <Th numeric>Improvement</Th>
          </tr>
        </thead>
        <tbody>
          <Row
            name="MAE"
            model={`${t.mae_mw.toFixed(1)} MW`}
            physics={`${t.mae_mw_physics.toFixed(1)} MW`}
            delta={`${(t.mae_mw_physics - t.mae_mw).toFixed(1)} MW`}
          />
          <Row
            name="nMAE (of nameplate)"
            model={`${t.nmae_pct.toFixed(2)}%`}
            physics={`${t.nmae_pct_physics.toFixed(2)}%`}
            delta={`${(t.nmae_pct_physics - t.nmae_pct).toFixed(2)} pts`}
          />
          <Row name="RMSE" model={`${t.rmse_mw.toFixed(1)} MW`} physics="—" delta="—" />
          <Row
            name="Validation rows"
            model={t.rows_valid.toLocaleString("en-IN")}
            physics="—"
            delta="—"
          />
        </tbody>
      </table>
    </Panel>
  );
}

function Row({
  name,
  model,
  physics,
  delta,
}: {
  name: string;
  model: string;
  physics: string;
  delta: string;
}) {
  return (
    <tr className="border-b border-[var(--gridline)] last:border-0">
      <Td>{name}</Td>
      <Td numeric>{model}</Td>
      <Td numeric muted>{physics}</Td>
      <Td numeric>
        {delta === "—" ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <span style={{ color: "var(--delta-pos)" }}>{delta}</span>
        )}
      </Td>
    </tr>
  );
}
