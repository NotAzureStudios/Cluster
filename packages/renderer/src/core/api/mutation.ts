import { classifyOfflineMutation, type OfflineConflictStrategy, type OfflineMutationSafety } from "../offline-policy";
import { getOfflineScopeIdentity, queueOfflineMutation, type OfflineMutationRecord, writeCachedResponse } from "../offline-storage";
import { sameOfflineRequestContext } from "../user-state-ownership";
import { readOfflineServerBinding } from "../offline-server-binding";
import { api } from "./transport";
import { ApiError, isApiNetworkFailure, isOnline } from "./errors";
import { mutationIdempotencyKey } from "./config";
import { invalidateApiQueries, setQueryCache } from "./cache";
import { invalidateMutationCache } from "./mutation-cache";
import { invalidateMutationQueries, persistentMutationHeaders } from "./mutation-support";

export type QueueableMutationOptions<T> = {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: HeadersInit;
  label: string;
  queueWhenOffline?: boolean;
  dedupeKey?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
  baseRevision?: number | null;
  dependsOn?: string[];
  optimisticResult?: T;
  optimisticCache?: Record<string, unknown>;
  invalidate?: string[];
  baseSnapshot?: Record<string, unknown> | null;
  localSnapshot?: Record<string, unknown> | null;
  changedFields?: string[];
  offlineSafety?: OfflineMutationSafety;
  conflictStrategy?: OfflineConflictStrategy;
};

export type QueueableMutationResult<T> = {
  queued: boolean;
  result?: T;
  mutation?: OfflineMutationRecord;
};

async function writeOptimisticCache(entries: Record<string, unknown> | undefined, originScope: string, isCurrent: () => boolean) {
  if (!entries || !Object.keys(entries).length || !isCurrent()) return;
  const cachedAt = Date.now();
  await Promise.all(
    Object.entries(entries).map(async ([path, value]) => {
      if (!isCurrent()) return;
      setQueryCache(`${originScope}:${path}`, { value, staleAt: cachedAt + 15_000, expiresAt: cachedAt + 7 * 24 * 60 * 60 * 1000, tags: ["optimistic"] });
      await writeCachedResponse({
        scope: originScope,
        path,
        value,
        cachedAt,
        staleAt: cachedAt + 15_000,
        expiresAt: cachedAt + 7 * 24 * 60 * 60 * 1000,
        tags: ["optimistic"],
      });
    }),
  );
}

function mutationBodyWithRevision(body: unknown, baseRevision?: number | null) {
  if (!baseRevision || !body || typeof body !== "object" || Array.isArray(body) || "expectedRevision" in (body as Record<string, unknown>)) return body;
  return { ...(body as Record<string, unknown>), expectedRevision: baseRevision };
}

const SENSITIVE_MUTATION_KEY = /(password|passcode|pin|secret|token|recoverycode)/i;

function containsSensitiveMutationData(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveMutationData(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => SENSITIVE_MUTATION_KEY.test(key) || containsSensitiveMutationData(nested, depth + 1));
}

export async function mutateApi<T>(path: string, options: QueueableMutationOptions<T>): Promise<QueueableMutationResult<T>> {
  const origin = getOfflineScopeIdentity();
  const isCurrent = () => sameOfflineRequestContext(origin, getOfflineScopeIdentity());
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error("Authentication context changed; the operation was not queued under another account.");
  };
  const queueWhenOffline = options.queueWhenOffline !== false;
  const headers = new Headers(options.headers || {});
  if (options.baseRevision) headers.set("X-Cluster-Base-Revision", String(options.baseRevision));
  const idempotencyKey = mutationIdempotencyKey(headers);
  const serializedHeaders = persistentMutationHeaders(headers);
  const mutationBody = mutationBodyWithRevision(options.body, options.baseRevision);
  const canPersist = !containsSensitiveMutationData(mutationBody);
  const policy = classifyOfflineMutation({ method: options.method, baseRevision: options.baseRevision, dedupeKey: options.dedupeKey, entityId: options.entityId, requestedSafety: options.offlineSafety, requestedConflictStrategy: options.conflictStrategy });
  const queue = async () => {
    ensureCurrent();
    if (policy.safety === "online_only") throw new ApiError(policy.reason, 503);
    const binding = readOfflineServerBinding(origin.scope);
    const mutation = await queueOfflineMutation({
      scope: origin.scope,
      serverInstanceId: binding?.serverInstanceId || null,
      serverDataEpoch: binding?.serverDataEpoch || null,
      serverVersion: binding?.serverVersion || null,
      contractVersion: binding?.contractVersion || null,
      mutationSchemaVersion: binding?.mutationSchemaVersion || null,
      path,
      method: options.method,
      body: mutationBody,
      headers: serializedHeaders,
      label: options.label,
      dedupeKey: options.dedupeKey,
      entityType: options.entityType,
      entityId: options.entityId,
      resourceKind: options.resourceKind,
      resourceId: options.resourceId,
      baseRevision: options.baseRevision,
      dependsOn: options.dependsOn,
      invalidatePaths: options.invalidate,
      baseSnapshot: options.baseSnapshot || null,
      localSnapshot: options.localSnapshot || (mutationBody && typeof mutationBody === "object" && !Array.isArray(mutationBody) ? mutationBody as Record<string, unknown> : null),
      changedFields: options.changedFields || (mutationBody && typeof mutationBody === "object" && !Array.isArray(mutationBody) ? Object.keys(mutationBody as Record<string, unknown>).filter((key) => key !== "expectedRevision") : []),
      safety: policy.safety,
      conflictStrategy: policy.conflictStrategy,
      maxAttempts: policy.maxAttempts,
      idempotencyKey,
    }, isCurrent);
    // Queued intent remains owned by the original account, even if the shell
    // signs out before optimistic UI/cache feedback can be written.
    if (isCurrent()) await writeOptimisticCache(options.optimisticCache, origin.scope, isCurrent);
    return { queued: true, result: options.optimisticResult, mutation } satisfies QueueableMutationResult<T>;
  };

  if (!isOnline()) {
    ensureCurrent();
    if (!queueWhenOffline || !canPersist) throw new ApiError("This action requires a connection.", 503);
    return queue();
  }

  try {
    const result = await api<T>(path, {
      method: options.method,
      headers,
      body: mutationBody === undefined ? undefined : JSON.stringify(mutationBody),
      skipCacheInvalidation: true,
    });
    if (isCurrent()) {
      invalidateMutationCache(path);
      invalidateMutationQueries(options.invalidate);
    }
    return { queued: false, result };
  } catch (error) {
    // A network timeout from account A is not permission to queue the payload
    // after another person has signed in as account B.
    ensureCurrent();
    if (error instanceof ApiError && error.status === 409 && error.code === "IDEMPOTENCY_ALREADY_COMMITTED") {
      // The server proves that the original write completed but cannot safely
      // replay a private response. Invalidate stale projections without
      // fabricating a typed response or queueing another mutation.
      invalidateMutationCache(path);
      invalidateMutationQueries(options.invalidate);
      throw error;
    }
    if (queueWhenOffline && canPersist && isApiNetworkFailure(error)) return queue();
    throw error;
  }
}
