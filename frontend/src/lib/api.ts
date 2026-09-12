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
  HistoryResponse,
  IngestResponse,
  IngestValidateResponse,
  Site,
  SiteListResponse,
  SimulatorDefaultsResponse,
  SimulatorRequest,
  SimulatorResponse,
  Technology,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

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
  cache?: RequestCache;
  signal?: AbortSignal;
  method?: string;
  body?: string | FormData;
  ttlMs?: number;
  skipCache?: boolean;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function getDefaultTtl(path: string): number {
  if (path.startsWith("/api/sites")) return 60_000;
  if (path.startsWith("/api/accuracy")) return 60_000;
  if (path.startsWith("/api/simulate/defaults")) return 60_000;
  if (path.startsWith("/api/health")) return 15_000;
  if (path.startsWith("/api/history")) return 30_000;
  if (path.startsWith("/api/forecast")) return 30_000;
  if (path.startsWith("/api/decisions")) return 30_000;
  return 30_000;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isGet = method === "GET" && !options.body;
  const cacheKey = `${method}:${path}`;

  // Check in-memory cache for GET requests
  if (isGet && !options.skipCache) {
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return Promise.resolve(cached.data as T);
    }

    // In-flight deduplication: if identical GET request is pending, reuse its promise
    const pending = inFlightRequests.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const exec = (async () => {
    let response: Response;
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        cache: options.cache ?? "no-store",
        signal: options.signal,
        method: options.method,
        body: options.body,
        headers: isFormData
          ? { Accept: "application/json" }
          : options.body
            ? { Accept: "application/json", "Content-Type": "application/json" }
            : { Accept: "application/json" },
      });
    } catch {
      // Network-level failure: the server is down, or CORS rejected us.
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

    const data = (await response.json()) as T;

    if (isGet && !options.skipCache) {
      const ttl = options.ttlMs ?? getDefaultTtl(path);
      memoryCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttl,
      });
    }

    return data;
  })();

  if (isGet && !options.skipCache) {
    inFlightRequests.set(cacheKey, exec);
    exec.catch(() => {}).finally(() => {
      inFlightRequests.delete(cacheKey);
    });
  }

  // Mutating requests invalidate relevant cache entries
  if (!isGet) {
    if (path.includes("/ingest")) {
      memoryCache.clear();
    }
  }

  return exec;
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

  validateCsv: (formData: FormData, options?: RequestOptions) =>
    request<IngestValidateResponse>("/api/ingest/validate", {
      ...options,
      method: "POST",
      body: formData,
    }),

  ingestCsv: (formData: FormData, options?: RequestOptions) =>
    request<IngestResponse>("/api/ingest/csv", {
      ...options,
      method: "POST",
      body: formData,
    }),

  history: (siteId: string, options?: RequestOptions) =>
    request<HistoryResponse>(`/api/history/${encodeURIComponent(siteId)}`, options),

  clearCache: () => {
    memoryCache.clear();
    inFlightRequests.clear();
  },
};
