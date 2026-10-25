import { classifyOfflineMutation, type OfflineConflictStrategy, type OfflineMutationSafety } from "../offline-policy";
import { getOfflineScope, queueOfflineMutation, type OfflineMutationRecord, writeCachedResponse } from "../offline-storage";
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

async function writeOptimisticCache(entries: Record<string, unknown> | undefined) {
  if (!entries || !Object.keys(entries).length) return;
  const cachedAt = Date.now();
  await Promise.all(
    Object.entries(entries).map(async ([path, value]) => {
      setQueryCache(`${getOfflineScope()}:${path}`, { value, staleAt: cachedAt + 15_000, expiresAt: cachedAt + 7 * 24 * 60 * 60 * 1000, tags: ["optimistic"] });
      await writeCachedResponse({
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
  const queueWhenOffline = options.queueWhenOffline !== false;
  const headers = new Headers(options.headers || {});
  if (options.baseRevision) headers.set("X-Cluster-Base-Revision", String(options.baseRevision));
  const idempotencyKey = mutationIdempotencyKey(headers);
  const serializedHeaders = persistentMutationHeaders(headers);
  const mutationBody = mutationBodyWithRevision(options.body, options.baseRevision);
  const canPersist = !containsSensitiveMutationData(mutationBody);
  const policy = classifyOfflineMutation({ method: options.method, baseRevision: options.baseRevision, dedupeKey: options.dedupeKey, entityId: options.entityId, requestedSafety: options.offlineSafety, requestedConflictStrategy: options.conflictStrategy });
  const queue = async () => {
    if (policy.safety === "online_only") throw new ApiError(policy.reason, 503);
    const binding = readOfflineServerBinding(getOfflineScope());
    const mutation = await queueOfflineMutation({
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
    });
    await writeOptimisticCache(options.optimisticCache);
    return { queued: true, result: options.optimisticResult, mutation } satisfies QueueableMutationResult<T>;
  };

  if (!isOnline()) {
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
    invalidateMutationCache(path);
    invalidateMutationQueries(options.invalidate);
    return { queued: false, result };
  } catch (error) {
    if (queueWhenOffline && canPersist && isApiNetworkFailure(error)) return queue();
    throw error;
  }
}
