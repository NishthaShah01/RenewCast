import { MotionSection } from "@/components/MotionSection";
import { Panel, ServiceDown, Stat, Td, Th } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { percent, technologyLabel } from "@/lib/format";
import type { AccuracyResponse, TechnologyAccuracy } from "@/lib/types";

export const metadata = {
  title: "Accuracy — RenewCast",
  description: "Empirical validation against held-out weather splits and baseline comparison.",
};

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
    <div className="flex flex-col gap-5">
      <MotionSection index={0}>
        <h1 className="text-20 font-semibold tracking-[-0.01em] text-ink-primary">Accuracy</h1>
        <p className="mt-0.5 text-12 text-ink-secondary">
          Validation against held-out forecast data.
        </p>
      </MotionSection>

      {data.technologies.map((t, i) => (
        <MotionSection key={t.technology} index={1 + i}>
          <TechnologyPanel t={t} />
        </MotionSection>
      ))}

      <MotionSection index={1 + data.technologies.length}>
        <Panel title="How these were produced" meta={`v${data.model_version}`}>
          <div className="grid grid-cols-1 gap-3 p-4 text-12 sm:grid-cols-2">
            <div>
              <span className="font-semibold text-ink-primary">Model: </span>
              <span className="text-ink-secondary">Physics + gradient-boosted quantile regression</span>
            </div>
            <div>
              <span className="font-semibold text-ink-primary">Validation: </span>
              <span className="text-ink-secondary">Held-out weather split</span>
            </div>
            <div>
              <span className="font-semibold text-ink-primary">Ground truth: </span>
              <span className="text-ink-secondary">Synthetic plant response from archived weather</span>
            </div>
            <div>
              <span className="font-semibold text-ink-primary">Limitations: </span>
              <span className="text-ink-secondary">Plant-level measured output is not publicly available</span>
            </div>
          </div>
        </Panel>
      </MotionSection>
    </div>
  );
}

function TechnologyPanel({ t }: { t: TechnologyAccuracy }) {
  // Coverage error in points
  const coverageError = t.pi_coverage - t.pi_nominal;

  return (
    <Panel
      title={technologyLabel(t.technology)}
      meta={`${t.rows_train.toLocaleString("en-IN")} training rows · ${t.n_features} features`}
      footnote={`${percent(t.pi_nominal, 0)} nominal coverage`}
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 px-4 py-3 sm:grid-cols-4">
        <Stat
          label="Skill over physics"
          value={`${t.skill_pct.toFixed(1)}%`}
          tone="positive"
          note="vs physics baseline"
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
    <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page)]/40 transition-colors duration-150">
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
