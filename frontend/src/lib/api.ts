/**
 * The API client.
 *
 * One rule: a failed request produces a message that can be shown to a user
 * verbatim. No "Error: Failed to fetch", no stack traces reaching the screen.
 * The backend already writes its 404s and 422s in the interface's voice, so
 * this passes those through and supplies its own sentence only when the
 * network itself failed.
 */

import type {
  AccuracyResponse,
  CopilotResponse,
  DecisionResponse,
  EnergySummary,
  ForecastResponse,
  HealthResponse,
  Site,
  SiteListResponse,
  SimulatorDefaultsResponse,
  SimulatorRequest,
  SimulatorResponse,
  Technology,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/** An error carrying copy that is safe to render directly. */
export class ApiError extends Error {
  readonly status: number;
  readonly hint?: string;

  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.hint = hint;
  }
}

interface RequestOptions {
  /** Server components pass `no-store`; the client layer caches via TanStack
   *  Query instead, so this defaults to no framework-level caching. */
  cache?: RequestCache;
  signal?: AbortSignal;
  method?: string;
  body?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: options.cache ?? "no-store",
      signal: options.signal,
      method: options.method,
      body: options.body,
      headers: options.body
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
    });
  } catch {
    // Network-level failure: the server is down, or CORS rejected us. Name
    // the likely cause and the fix, because "Failed to fetch" tells a user
    // nothing they can act on.
    throw new ApiError(
      `Can't reach the forecast service at ${API_BASE}.`,
      0,
      "Start the backend with `uvicorn app.main:app --reload --port 8000` from the backend directory.",
    );
  }

  if (!response.ok) {
    let detail = `The forecast service returned ${response.status}.`;
    let hint: string | undefined;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
      if (typeof body?.hint === "string") hint = body.hint;
    } catch {
      // Non-JSON error body — keep the status-based sentence above.
    }
    throw new ApiError(detail, response.status, hint);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: (options?: RequestOptions) => request<HealthResponse>("/api/health", options),

  sites: (technology?: Technology, options?: RequestOptions) =>
    request<SiteListResponse>(
      technology ? `/api/sites?technology=${technology}` : "/api/sites",
      options,
    ),

  site: (id: string, options?: RequestOptions) =>
    request<Site>(`/api/sites/${encodeURIComponent(id)}`, options),

  // The query parameter is `horizon_hours`, matching the backend signature
  // exactly. FastAPI silently ignores parameters it does not declare, so an
  // approximate name here is worse than a wrong one: `hours=24` returned a
  // full 72-hour forecast with a 200 and no warning anywhere.
  forecast: (id: string, horizonHours = 72, options?: RequestOptions) =>
    request<ForecastResponse>(
      `/api/forecast/${encodeURIComponent(id)}?horizon_hours=${horizonHours}`,
      options,
    ),

  summary: (id: string, options?: RequestOptions) =>
    request<EnergySummary>(`/api/forecast/${encodeURIComponent(id)}/summary`, options),

  fleetSummary: (technology?: Technology, options?: RequestOptions) =>
    request<EnergySummary[]>(
      technology ? `/api/forecast?technology=${technology}` : "/api/forecast",
      options,
    ),

  decisions: (id: string, horizonHours = 24, options?: RequestOptions) =>
    request<DecisionResponse>(
      `/api/decisions/${encodeURIComponent(id)}?horizon_hours=${horizonHours}`,
      options,
    ),

  accuracy: (options?: RequestOptions) =>
    request<AccuracyResponse>("/api/accuracy", options),

  ask: (siteId: string, question: string, options?: RequestOptions) =>
    request<CopilotResponse>("/api/copilot", {
      ...options,
      method: "POST",
      body: JSON.stringify({ site_id: siteId, question }),
    }),

  simulate: (req: SimulatorRequest, options?: RequestOptions) =>
    request<SimulatorResponse>("/api/simulate", {
      ...options,
      method: "POST",
      body: JSON.stringify(req),
    }),

  simulateDefaults: (siteId: string, options?: RequestOptions) =>
    request<SimulatorDefaultsResponse>(
      `/api/simulate/defaults/${encodeURIComponent(siteId)}`,
      options,
    ),
};
