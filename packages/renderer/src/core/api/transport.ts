import { CLUSTER_PERSON_CHANGED_EVENT, CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, clusterErrorDefinition, type ClusterAssignmentChange } from "@cluster/shared";
import { ClusterApiClientError, clusterApiFetch } from "@cluster/api-client";
import { emitClusterCohesionEvent } from "../cohesion-events";
import { recordPerformanceMetric } from "../performance";
import { requestReauthentication, type ReauthenticationPurpose } from "../reauthentication";
import { shouldInvalidateAuthenticatedClientForError } from "../session-lifecycle";
import { getOfflineScopeIdentity, resumeAuthenticationPausedOfflineWork, setOfflineScope } from "../offline-storage";
import { authenticatedUserIdFromResponse, isCurrentAccountRequest } from "./auth-context";
import { API_TIMEOUT_MS, installationDeviceId, type ApiRequestOptions } from "./config";
import { ApiError, apiOperationLabel, type ApiErrorIssue } from "./errors";
import { invalidateAuthenticatedClientState } from "./cache";
import { invalidateMutationCache } from "./mutation-cache";

function combineSignals(timeoutSignal: AbortSignal, external?: AbortSignal | null): { signal: AbortSignal; cleanup: () => void } {
  if (!external) return { signal: timeoutSignal, cleanup: () => undefined };
  if (typeof AbortSignal.any === "function") return { signal: AbortSignal.any([timeoutSignal, external]), cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  timeoutSignal.addEventListener("abort", abort, { once: true });
  external.addEventListener("abort", abort, { once: true });
  if (timeoutSignal.aborted || external.aborted) controller.abort();
  return { signal: controller.signal, cleanup: () => {
    timeoutSignal.removeEventListener("abort", abort);
    external.removeEventListener("abort", abort);
  } };
}

async function parseResponse(res: Response, context: { method: string; path: string; occurredAt: string }) {
  const text = await res.text();
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  let payload: unknown = null;
  let parseFailed = false;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      parseFailed = true;
      payload = text;
    }
  }
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) {
    if (parseFailed) {
      throw new ApiError(
        `The server returned ${res.status} with an unreadable ${contentType.includes("text/html") ? "HTML" : "non-JSON"} response.`,
        res.status,
        null,
        requestId,
        "SERVER_RESPONSE_INVALID",
        { operation: apiOperationLabel(context.method, context.path), occurredAt: context.occurredAt },
      );
    }
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const code = String(record?.code || (res.status === 408 ? "REQUEST_TIMEOUT" : res.status >= 502 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR"));
    const definition = clusterErrorDefinition(code);
    const issues = Array.isArray(record?.issues)
      ? record.issues.filter((issue): issue is ApiErrorIssue => Boolean(issue && typeof issue === "object" && "message" in issue)).slice(0, 20)
      : [];
    const message = String(record?.error || record?.message || definition?.message || `Request failed with status ${res.status}.`);
    throw new ApiError(message, res.status, payload, String(record?.requestId || requestId || "") || null, code, {
      title: String(record?.title || definition?.title || "Request failed"),
      action: String(record?.action || definition?.action || "Retry the action or inspect Cluster diagnostics."),
      retryable: typeof record?.retryable === "boolean" ? record.retryable : definition?.retryable,
      contractVersion: String(record?.contractVersion || res.headers.get("x-cluster-api-contract") || "") || null,
      operation: String(record?.operation || apiOperationLabel(context.method, context.path)),
      occurredAt: String(record?.occurredAt || context.occurredAt),
      retryAfterSeconds: (() => {
        const raw = res.headers.get("retry-after");
        if (!raw) return null;
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) return Math.max(0, seconds);
        const date = Date.parse(raw);
        return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
      })(),
      issues,
    });
  }
  if (parseFailed && contentType.includes("application/json")) {
    throw new ApiError("The server returned malformed JSON.", res.status || 200, null, requestId, "SERVER_RESPONSE_INVALID", {
      operation: apiOperationLabel(context.method, context.path),
      occurredAt: context.occurredAt,
    });
  }
  return payload;
}

export async function rawApi<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = String(options.method || "GET").toUpperCase();
  const occurredAt = new Date().toISOString();
  const operation = apiOperationLabel(method, path);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  let responseStatus = 0;
  const controller = new AbortController();
  // Reads can be delayed by the server's authoritative Retry-After window.
  // Give those retries time to complete without weakening the timeout on writes.
  const requestTimeoutMs = method === "GET" || method === "HEAD" ? API_TIMEOUT_MS + 65_000 : API_TIMEOUT_MS;
  const timeout = typeof window !== "undefined" ? window.setTimeout(() => controller.abort(), requestTimeoutMs) : setTimeout(() => controller.abort(), requestTimeoutMs);
  const { signal, cleanup: cleanupSignals } = combineSignals(controller.signal, options.signal);
  const headers = new Headers(options.headers || {});
  if (!headers.has("X-Cluster-Device-Id")) headers.set("X-Cluster-Device-Id", installationDeviceId());
  if (!(options.body instanceof FormData) && options.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    const res = await clusterApiFetch(path, {
      ...options,
      credentials: "include",
      signal,
      headers,
    });
    responseStatus = res.status;
    return (await parseResponse(res, { method, path, occurredAt })) as T;
  } catch (error) {
    if (error instanceof ClusterApiClientError) {
      throw new ApiError(error.message, error.status, error.payload, error.requestId, error.code, {
        action: error.action || undefined,
        retryable: error.retryable,
        contractVersion: error.contractVersion,
        retryAfterSeconds: error.retryAfterSeconds,
        operation: error.operation || operation,
        occurredAt: error.occurredAt || occurredAt,
        issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code })),
      });
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      // Unmounting a tab or cancelling a search is not a server timeout.
      // Let the caller's cancellation handlers ignore this abort normally.
      if (options.signal?.aborted && !controller.signal.aborted) throw error;
      throw new ApiError(`The request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`, 408, undefined, null, "REQUEST_TIMEOUT", { operation, occurredAt });
    }
    if (error instanceof TypeError) {
      throw new ApiError("Cluster could not reach the configured server.", 0, undefined, null, "NETWORK_UNAVAILABLE", { operation, occurredAt });
    }
    throw error;
  } finally {
    cleanupSignals();
    if (typeof window !== "undefined") window.clearTimeout(timeout as number);
    else clearTimeout(timeout);
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordPerformanceMetric({
      name: `${method} ${path.split("?")[0]}`,
      category: "network",
      durationMs: endedAt - startedAt,
      startedAt: Date.now() - (endedAt - startedAt),
      detail: { status: responseStatus || null, cached: false },
    });
  }
}


function requestBodyRecord(options: ApiRequestOptions) {
  if (typeof options.body === "string") { try { const parsed = JSON.parse(options.body); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; } }
  return options.body && typeof options.body === "object" && !(options.body instanceof FormData) && !(options.body instanceof Blob) ? options.body as unknown as Record<string, unknown> : null;
}

function responseEntityId(path: string, payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, any> : null;
  const firstBlock = Array.isArray(record?.blocks) && record.blocks[0] && typeof record.blocks[0] === "object" ? record.blocks[0] as Record<string, unknown> : null;
  const direct = typeof record?.id === "string" ? record.id : typeof record?.card?.id === "string" ? record.card.id : typeof record?.event?.id === "string" ? record.event.id : typeof record?.block?.id === "string" ? record.block.id : typeof firstBlock?.id === "string" ? firstBlock.id : null;
  if (direct) return direct;
  const segments = path.split("?")[0].split("/").filter(Boolean);
  const tail = segments.at(-1) || "";
  return /^[a-z0-9_-]{8,}$/i.test(tail) && !["cards", "tickets", "events", "blocks", "presence"].includes(tail) ? tail : null;
}

function emitMutationCohesion(path: string, method: string, payload: unknown, options: ApiRequestOptions) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || typeof window === "undefined") return;
  const body = requestBodyRecord(options);
  if (!body) return;
  if (path === "/api/me/presence" || /^\/api\/users\/[^/]+$/.test(path.split("?")[0])) {
    const record = payload && typeof payload === "object" ? payload as Record<string, any> : null;
    const person = record?.user || record;
    if (person?.id) {
      emitClusterCohesionEvent(CLUSTER_PERSON_CHANGED_EVENT, { id: person.id, status: person.status, statusMessage: person.statusMessage, lastSeenAt: person.lastSeenAt });
    }
  }
  let kind: ClusterAssignmentChange["resource"]["kind"] | null = null;
  if (/^\/api\/(cards|tickets)(?:\/|$)/.test(path)) kind = path.startsWith("/api/tickets") ? "ticket" : "card";
  else if (/^\/api\/calendar\/events(?:\/|$)/.test(path)) kind = "calendar";
  else if (/^\/api\/schedule\/blocks(?:\/|$)/.test(path)) kind = "scheduler";
  const assignmentTouched = kind === "card" || kind === "ticket" ? Object.prototype.hasOwnProperty.call(body, "assigneeId") : kind === "calendar" ? (Object.prototype.hasOwnProperty.call(body, "ownerId") || Object.prototype.hasOwnProperty.call(body, "attendeeIds")) : kind === "scheduler" ? Object.prototype.hasOwnProperty.call(body, "userId") : false;
  if (!kind || !assignmentTouched) return;
  const id = responseEntityId(path, payload);
  if (!id) return;
  const record = payload && typeof payload === "object" ? payload as Record<string, any> : null;
  const projectId = String(body.projectId || record?.projectId || record?.card?.projectId || "") || null;
  const assigneeId = kind === "calendar" ? String(body.ownerId || "") || null : kind === "scheduler" ? String(body.userId || "") || null : String(body.assigneeId || "") || null;
  emitClusterCohesionEvent<ClusterAssignmentChange>(CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, { resource: { kind, id, ...(projectId ? { projectId } : {}) }, kind: "assignee", subject: assigneeId ? { kind: "user", id: assigneeId } : null, projectId, actorUserId: null });
}
export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = String(options.method || "GET").toUpperCase();
  const startedAccount = getOfflineScopeIdentity();
  const accountUnchanged = () => isCurrentAccountRequest(startedAccount, getOfflineScopeIdentity());
  let payload: T;
  try {
    payload = await rawApi<T>(path, options);
  } catch (error) {
    const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    if (unsafe && path !== "/api/auth/reauth" && error instanceof ApiError && error.code === "AUTH_REAUTH_REQUIRED") {
      const reauthPayload = error.payload && typeof error.payload === "object" ? error.payload as Record<string, unknown> : null;
      const purpose = typeof reauthPayload?.reauthenticationPurpose === "string" ? reauthPayload.reauthenticationPurpose as ReauthenticationPurpose : undefined;
      const confirmed = await requestReauthentication({
        title: "Confirm your identity",
        description: "Cluster requires a short security confirmation before this action can continue.",
        purpose,
        pinAllowed: reauthPayload?.pinAllowed === true,
        passwordAllowed: reauthPayload?.passwordAllowed !== false,
        passkeyAvailable: reauthPayload?.passkeyAvailable === true,
        passkeyRequired: reauthPayload?.passkeyRequired === true,
        minimumStrength: typeof reauthPayload?.reauthenticationMinimumStrength === "string" ? reauthPayload.reauthenticationMinimumStrength as any : undefined,
        reasonMode: reauthPayload?.reauthenticationReasonMode === "required" ? "required" : reauthPayload?.reauthenticationReasonMode === "optional" ? "optional" : "none",
      });
      if (!confirmed) throw error;
      // A reauthentication prompt may outlive the session that requested it.
      if (!accountUnchanged()) throw new ApiError("The account changed before this request could be retried.", 409, null, null, "AUTH_CONTEXT_CHANGED");
      payload = await rawApi<T>(path, options);
    } else {
      if (accountUnchanged() && error instanceof ApiError && shouldInvalidateAuthenticatedClientForError({ status: error.status, code: error.code, path })) await invalidateAuthenticatedClientState("auth_required");
      throw error;
    }
  }
  // An old /me, login or logout response must not rebind or clear a newer
  // account. The caller also receives an explicit stale-context failure.
  if (!accountUnchanged()) throw new ApiError("This request belongs to a previous account session.", 409, null, null, "AUTH_CONTEXT_CHANGED");
  const userId = authenticatedUserIdFromResponse(path, payload);
  if (userId) {
    setOfflineScope(userId);
    void resumeAuthenticationPausedOfflineWork(userId).catch(() => undefined);
  }
  const responseRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  if ((path === "/api/auth/logout" && method !== "GET") || responseRecord?.signedOut === true || responseRecord?.currentSessionRevoked === true) {
    await invalidateAuthenticatedClientState(path === "/api/auth/logout" ? "logout" : "session_revoked");
  }
  emitMutationCohesion(path, method, payload, options);
  if (method !== "GET" && method !== "HEAD" && !options.skipCacheInvalidation) invalidateMutationCache(path);
  return payload;
}
