/**
 * The forecast horizon, as a URL parameter.
 *
 * The horizon lives in the query string rather than in component state so that
 * a chosen window survives a reload and can be pasted to a colleague. The
 * server components read it directly from `searchParams`, which means the
 * selector changes the actual request rather than re-filtering data the client
 * already had.
 *
 * ## What the horizon does and does not change
 *
 * It changes the forecast request: `/api/forecast` returns blocks from the
 * start of today through now + horizon, so 72 h returns roughly three times
 * the blocks of 24 h.
 *
 * It does not change the despatch plan. `build_decisions` filters to a single
 * despatch date on purpose — block 43 has to be a unique address, and a
 * multi-day plan would carry two rows claiming to be block 7. So the decisions
 * request is left at its own 24-hour default and the selector is not offered
 * on the plan page, where it would be a control that does nothing.
 */

/** The offered windows, in hours. The backend caps at `max_horizon_hours`. */
export const HORIZON_OPTIONS = [24, 48, 72] as const;

export type Horizon = (typeof HORIZON_OPTIONS)[number];

/**
 * 24 h, matching what the site page requested before the selector existed.
 *
 * Not the API's own 72 h default: the visible default has to stay what it is
 * today, or adding a control would silently change every existing link.
 */
export const DEFAULT_HORIZON: Horizon = 24;

/** The query key. One constant, because it is written in three places. */
export const HORIZON_PARAM = "horizon";

/**
 * Read a horizon out of a `searchParams` value.
 *
 * Anything unrecognised falls back to the default rather than throwing. A
 * hand-edited URL should show a forecast, not an error page — and `?horizon=`
 * arrives as `string | string[] | undefined` depending on how many times the
 * key appears, so all three shapes are handled here rather than at each call.
 */
export function parseHorizon(raw: string | string[] | undefined): Horizon {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return (HORIZON_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as Horizon)
    : DEFAULT_HORIZON;
}

/** `'72 h'` — the label used on the control and in panel metadata. */
export function horizonLabel(horizon: Horizon): string {
  return `${horizon} h`;
}
