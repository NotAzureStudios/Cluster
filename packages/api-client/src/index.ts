import type { ApiErrorDetail, ApiErrorResponse, ClusterServerCapability as ClusterKnownServerCapability } from "@cluster/shared";
import { readTrafficLane, readTrafficLanes, readRateLimitCooldown, noteReadRateLimit, resetReadRateLimitCooldowns, readRateLimitGeneration } from "./read-rate-limit.js";

export const CLUSTER_API_CLIENT_PROTOCOL_VERSION = 2 as const;

export const CLUSTER_CLIENT_HEADERS = {
  version: "X-Cluster-Client-Version",
  host: "X-Cluster-Client-Host",
  protocol: "X-Cluster-Client-Protocol",
  requestId: "X-Client-Request-Id",
  csrf: "X-Cluster-CSRF",
  idempotency: "X-Cluster-Idempotency-Key",
  deviceId: "X-Cluster-Device-Id",
  deviceProofTimestamp: "X-Cluster-Device-Proof-Timestamp",
  deviceProofSignature: "X-Cluster-Device-Proof-Signature",
  deviceProofPublicKey: "X-Cluster-Device-Proof-Public-Key",
  deviceProofAlgorithm: "X-Cluster-Device-Proof-Algorithm",
} as const;

export type ClusterApiClientRuntime = {
  baseUrl: string;
  clientVersion?: string;
  rendererHost: "web" | "desktop";
  protocolVersion: number;
  maxReadRetries: number;
  retryBaseDelayMs: number;
  retryMaximumDelayMs: number;
  requestHeaderProvider?: (input: { pathname: string; method: string; requestId: string }) => Promise<HeadersInit | null | undefined> | HeadersInit | null | undefined;
};

export type ClusterServerCapability = ClusterKnownServerCapability | (string & {});

export type ClusterCompatibilityResponse = {
  ok: boolean;
  compatible: boolean;
  reason?: string;
  clientVersion: string;
  serverVersion: string;
  contractVersion: string;
  minimumClientVersion: string;
  capabilities?: ClusterServerCapability[];
};

export type ClusterApiServerMetadata = {
  serverVersion: string | null;
  contractVersion: string | null;
  minimumClientVersion: string | null;
  compatibility: string | null;
  protocolCompatibility: string | null;
  transportProtocolVersion: number | null;
  serverState: string | null;
  serverMode: string | null;
  requestId: string | null;
  correlationId: string | null;
  receivedAt: string | null;
};

export class ClusterApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly contractVersion: string | null;
  readonly action: string | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly operation: string | null;
  readonly occurredAt: string | null;
  readonly details: Record<string, unknown> | null;
  readonly issues: ApiErrorDetail[];
  readonly payload: unknown;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    requestId?: string | null;
    contractVersion?: string | null;
    action?: string | null;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
    operation?: string | null;
    occurredAt?: string | null;
    details?: Record<string, unknown> | null;
    issues?: ApiErrorDetail[];
    payload?: unknown;
  }) {
    super(input.message);
    this.name = "ClusterApiClientError";
    this.status = input.status;
    this.code = input.code || "INTERNAL_ERROR";
    this.requestId = input.requestId || null;
    this.contractVersion = input.contractVersion || null;
    this.action = input.action || null;
    this.retryable = input.retryable ?? (input.status === 0 || input.status === 408 || input.status >= 500);
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.operation = input.operation || null;
    this.occurredAt = input.occurredAt || null;
    this.details = input.details || null;
    this.issues = input.issues || [];
    this.payload = input.payload;
  }
}

let runtime: ClusterApiClientRuntime = {
  baseUrl: "",
  rendererHost: "web",
  protocolVersion: CLUSTER_API_CLIENT_PROTOCOL_VERSION,
  maxReadRetries: 1,
  retryBaseDelayMs: 250,
  retryMaximumDelayMs: 3_000,
};


const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/mfa/challenge",
  "/api/auth/dev-login",
  "/api/setup/status",
  "/api/setup/complete",
]);
const SESSION_CHANGING_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/mfa/challenge",
  "/api/auth/session-password",
  "/api/auth/reauth",
  "/api/auth/dev-login",
  "/api/auth/logout",
]);
let csrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;

function requestPathname(pathname: string) {
  return String(pathname || "").split("?")[0] || "/";
}

function needsCsrf(pathname: string, method: string) {
  const path = requestPathname(pathname);
  return path.startsWith("/api/") && !path.startsWith("/api/public/") && !SAFE_HTTP_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(path);
}


function needsIdempotency(pathname: string, method: string) {
  const path = requestPathname(pathname);
  return path.startsWith("/api/") &&
    !SAFE_HTTP_METHODS.has(method) &&
    !path.startsWith("/api/auth/") &&
    !path.startsWith("/api/public/") &&
    !path.includes("/security/pin") &&
    !path.includes("/password");
}

function clearCsrfToken() {
  csrfToken = null;
  csrfPromise = null;
}

async function fetchCsrfToken() {
  if (csrfToken) return csrfToken;
  if (csrfPromise) return csrfPromise;
  csrfPromise = (async () => {
    try {
      const response = await fetch(clusterApiUrl("/api/auth/csrf"), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: requestHeaders({ Accept: "application/json" }),
      });
      updateServerMetadata(response);
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null) as { token?: unknown } | null;
      const token = typeof payload?.token === "string" ? payload.token.trim() : "";
      if (token.length < 20 || token.length > 256) return null;
      csrfToken = token;
      return token;
    } catch {
      return null;
    } finally {
      csrfPromise = null;
    }
  })();
  return csrfPromise;
}

let serverMetadata: ClusterApiServerMetadata = {
  serverVersion: null,
  contractVersion: null,
  minimumClientVersion: null,
  compatibility: null,
  protocolCompatibility: null,
  transportProtocolVersion: null,
  serverState: null,
  serverMode: null,
  requestId: null,
  correlationId: null,
  receivedAt: null,
};

export function normalizeClusterApiBaseUrl(value: string | undefined | null) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return clean.replace(/\/+$/, "");
}

function boundedRuntimeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

export function configureClusterApiClient(input: Partial<ClusterApiClientRuntime>) {
  const previousBaseUrl = runtime.baseUrl;
  runtime = {
    ...runtime,
    ...input,
    baseUrl: normalizeClusterApiBaseUrl(input.baseUrl ?? runtime.baseUrl),
    protocolVersion: input.protocolVersion ?? runtime.protocolVersion ?? CLUSTER_API_CLIENT_PROTOCOL_VERSION,
    maxReadRetries: boundedRuntimeNumber(input.maxReadRetries, runtime.maxReadRetries ?? 1, 0, 5),
    retryBaseDelayMs: boundedRuntimeNumber(input.retryBaseDelayMs, runtime.retryBaseDelayMs ?? 250, 25, 30_000),
    retryMaximumDelayMs: boundedRuntimeNumber(input.retryMaximumDelayMs, runtime.retryMaximumDelayMs ?? 3_000, 100, 120_000),
  };
  if (runtime.baseUrl !== previousBaseUrl) {
    clearCsrfToken();
    // A Retry-After window belongs to the server that issued it. Carrying the
    // old limit into a different Cluster installation stalls valid navigation.
    resetReadRateLimitCooldowns();
  }
  return { ...runtime };
}

export function clusterApiClientRuntime() {
  return { ...runtime };
}

export function clusterApiServerMetadata() {
  return { ...serverMetadata };
}

export function clusterApiUrl(pathname: string) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${runtime.baseUrl}${path}`;
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `cluster-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function updateServerMetadata(response: Response) {
  serverMetadata = {
    serverVersion: response.headers.get("x-cluster-version"),
    contractVersion: response.headers.get("x-cluster-api-contract"),
    minimumClientVersion: response.headers.get("x-cluster-minimum-client-version"),
    compatibility: response.headers.get("x-cluster-client-compatibility"),
    protocolCompatibility: response.headers.get("x-cluster-client-protocol-compatibility"),
    transportProtocolVersion: Number(response.headers.get("x-cluster-transport-protocol")) || null,
    serverState: response.headers.get("x-cluster-server-state"),
    serverMode: response.headers.get("x-cluster-server-mode"),
    requestId: response.headers.get("x-request-id"),
    correlationId: response.headers.get("x-cluster-correlation-id"),
    receivedAt: new Date().toISOString(),
  };
}

function requestHeaders(input?: HeadersInit) {
  const headers = new Headers(input || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (runtime.clientVersion && !headers.has(CLUSTER_CLIENT_HEADERS.version)) headers.set(CLUSTER_CLIENT_HEADERS.version, runtime.clientVersion);
  if (!headers.has(CLUSTER_CLIENT_HEADERS.host)) headers.set(CLUSTER_CLIENT_HEADERS.host, runtime.rendererHost);
  if (!headers.has(CLUSTER_CLIENT_HEADERS.protocol)) headers.set(CLUSTER_CLIENT_HEADERS.protocol, String(runtime.protocolVersion));
  if (!headers.has(CLUSTER_CLIENT_HEADERS.requestId)) headers.set(CLUSTER_CLIENT_HEADERS.requestId, createClientRequestId());
  return headers;
}

function delay(milliseconds: number, signal?: AbortSignal | null) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function retryableReadStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelayMilliseconds(attempt: number, response?: Response) {
  const retryAfter = response ? retryAfterSeconds(response) : null;
  if (retryAfter !== null) return Math.min(60_000, Math.max(0, retryAfter * 1_000));
  const exponential = runtime.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * Math.max(1, runtime.retryBaseDelayMs));
  return Math.min(runtime.retryMaximumDelayMs, exponential + jitter);
}

export async function clusterApiFetch(pathname: string, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  const trafficLanes = readTrafficLanes(pathname, method);
  const trafficLane = trafficLanes[0] || null;
  // Ignore a late 429 from a request started before an account/server switch.
  const requestCooldownGeneration = readRateLimitGeneration();
  const maximumAttempts = 1 + (canRetry ? runtime.maxReadRetries : 0);
  const baseHeaders = requestHeaders(init.headers);
  const requestId = baseHeaders.get(CLUSTER_CLIENT_HEADERS.requestId) || createClientRequestId();
  if (!baseHeaders.has(CLUSTER_CLIENT_HEADERS.requestId)) baseHeaders.set(CLUSTER_CLIENT_HEADERS.requestId, requestId);
  if (runtime.requestHeaderProvider) {
    let provided: HeadersInit | null | undefined = null;
    try { provided = await runtime.requestHeaderProvider({ pathname, method, requestId }); } catch { provided = null; }
    if (provided) {
      const dynamicHeaders = new Headers(provided);
      dynamicHeaders.forEach((value, key) => { if (!baseHeaders.has(key)) baseHeaders.set(key, value); });
    }
  }
  if (needsIdempotency(pathname, method) && !baseHeaders.has(CLUSTER_CLIENT_HEADERS.idempotency)) {
    baseHeaders.set(CLUSTER_CLIENT_HEADERS.idempotency, createClientRequestId());
  }
  const csrfRequired = needsCsrf(pathname, method);
  if (csrfRequired && !baseHeaders.has(CLUSTER_CLIENT_HEADERS.csrf)) {
    const token = await fetchCsrfToken();
    if (token) baseHeaders.set(CLUSTER_CLIENT_HEADERS.csrf, token);
  }
  let lastError: unknown = null;
  let csrfRetried = false;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      if (trafficLanes.length) await Promise.all(trafficLanes.map((lane) => readRateLimitCooldown(lane, init.signal)));
      const headers = new Headers(baseHeaders);
      const response = await fetch(clusterApiUrl(pathname), {
        ...init,
        credentials: init.credentials ?? "include",
        headers,
      });
      updateServerMetadata(response);
      // Respect the server window across parallel widgets: a 429 must not
      // multiply into several immediate retries from every component.
      if (response.status === 429 && trafficLane && requestCooldownGeneration === readRateLimitGeneration()) {
        const authoritativeLane = response.headers.get("X-Cluster-Rate-Limit-Bucket");
        const limitedLane = authoritativeLane && trafficLanes.includes(authoritativeLane) ? authoritativeLane : trafficLane;
        noteReadRateLimit(limitedLane, response.headers.get("retry-after"));
      }

      if (csrfRequired && !csrfRetried && response.headers.get("x-cluster-csrf-invalid") === "1") {
        csrfRetried = true;
        clearCsrfToken();
        const token = await fetchCsrfToken();
        if (token) {
          baseHeaders.set(CLUSTER_CLIENT_HEADERS.csrf, token);
          await response.body?.cancel().catch(() => undefined);
          attempt -= 1;
          continue;
        }
      }

      if (SESSION_CHANGING_PATHS.has(requestPathname(pathname)) && response.ok) {
        clearCsrfToken();
        // A successful login/logout/reauthentication changes the rate-limit
        // identity. Don't force the new session through a previous one's 429.
        resetReadRateLimitCooldowns();
      }

      if (attempt < maximumAttempts && retryableReadStatus(response.status) && !init.signal?.aborted) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status !== 429 || !trafficLane) await delay(retryDelayMilliseconds(attempt, response), init.signal);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof ClusterApiClientError) throw error;
      const aborted = init.signal?.aborted || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError");
      if (!aborted && attempt < maximumAttempts) {
        await delay(retryDelayMilliseconds(attempt), init.signal);
        continue;
      }
      throw new ClusterApiClientError({
        message: aborted ? "The Cluster request was cancelled or timed out." : "Cluster could not reach the configured server.",
        status: aborted ? 408 : 0,
        code: aborted ? "REQUEST_TIMEOUT" : "NETWORK_UNAVAILABLE",
        retryable: true,
        payload: error,
      });
    }
  }

  throw new ClusterApiClientError({
    message: "Cluster could not reach the configured server after retrying.",
    status: 0,
    code: "NETWORK_UNAVAILABLE",
    retryable: true,
    payload: lastError,
  });
}

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

function sanitizedOperation(pathname: string, method = "GET") {
  const route = requestPathname(pathname)
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      if (/^[a-z0-9_-]{20,}$/i.test(segment) && /\d/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
  return `${String(method || "GET").toUpperCase().slice(0, 12)} ${route || "/"}`.slice(0, 200);
}

function defaultErrorCode(status: number) {
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 408) return "REQUEST_TIMEOUT";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "BODY_TOO_LARGE";
  if (status === 426) return "CLIENT_UPGRADE_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503 || status === 504) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

async function responsePayload(response: Response, context?: { pathname?: string; method?: string }) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ClusterApiClientError({
      message: `Cluster returned ${response.status} with an unreadable response.`,
      status: response.status,
      code: "SERVER_RESPONSE_INVALID",
      requestId: response.headers.get("x-request-id"),
      contractVersion: response.headers.get("x-cluster-api-contract"),
      retryAfterSeconds: retryAfterSeconds(response),
      operation: context?.pathname ? sanitizedOperation(context.pathname, context.method) : null,
      occurredAt: new Date().toISOString(),
      payload: text,
    });
  }
}

export async function clusterApiJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await clusterApiFetch(pathname, init);
  const method = String(init?.method || "GET").toUpperCase();
  const payload = await responsePayload(response, { pathname, method });
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Partial<ApiErrorResponse> & Record<string, unknown> : null;
    const issues = Array.isArray(record?.issues)
      ? record.issues.filter((issue: unknown): issue is ApiErrorDetail => Boolean(issue && typeof issue === "object" && typeof (issue as ApiErrorDetail).message === "string")).slice(0, 20)
      : [];
    throw new ClusterApiClientError({
      message: String(record?.error || record?.message || `Cluster returned ${response.status}.`),
      status: response.status,
      code: String(record?.code || defaultErrorCode(response.status)),
      requestId: String(record?.requestId || response.headers.get("x-request-id") || "") || null,
      contractVersion: String(record?.contractVersion || response.headers.get("x-cluster-api-contract") || "") || null,
      action: typeof record?.action === "string" ? record.action : null,
      retryable: typeof record?.retryable === "boolean" ? record.retryable : undefined,
      retryAfterSeconds: retryAfterSeconds(response),
      operation: typeof record?.operation === "string" ? record.operation : sanitizedOperation(pathname, method),
      occurredAt: typeof record?.occurredAt === "string" ? record.occurredAt : new Date().toISOString(),
      details: record?.details && typeof record.details === "object" ? record.details as Record<string, unknown> : null,
      issues,
      payload,
    });
  }
  return payload as T;
}

export function clusterSupportsCapability(
  compatibility: Pick<ClusterCompatibilityResponse, "capabilities"> | null | undefined,
  capability: ClusterServerCapability,
) {
  return compatibility?.capabilities?.includes(capability) === true;
}

export function fetchClusterCompatibility(clientVersion = runtime.clientVersion || "0.0.0") {
  const query = new URLSearchParams({ clientVersion });
  return clusterApiJson<ClusterCompatibilityResponse>(`/api/meta/compatibility?${query.toString()}`);
}
