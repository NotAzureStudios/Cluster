import { shouldQuarantineMutation } from "../offline-policy";
import { getOfflineScope, listOfflineMutations, removeOfflineMutation, updateOfflineMutation, type OfflineMutationRecord } from "../offline-storage";
import { queuedWorkMatchesServerBinding, readOfflineServerBinding } from "../offline-server-binding";
import { recordPerformanceMetric } from "../performance";
import { APP_VERSION } from "../version";
import { ApiError, isOnline } from "./errors";
import { rawApi, api } from "./transport";
import { syncDeviceId } from "./config";
import { invalidateMutationCache } from "./mutation-cache";
import { invalidateMutationQueries } from "./mutation-support";
import { retryDelay } from "./offline-replay";

const OFFLINE_MUTATIONS_PER_FLUSH = 200;
const OFFLINE_MUTATION_BATCH_SIZE = 20;
let flushPromise: Promise<OfflineMutationRecord[]> | null = null;

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function dependencyCycleIds(items: OfflineMutationRecord[]) {
  const pending = new Map(items.filter((item) => item.status === "pending").map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.lastIndexOf(id);
      for (const cycleId of stack.slice(Math.max(0, start))) cycles.add(cycleId);
      cycles.add(id);
      return;
    }
    const item = pending.get(id);
    if (!item) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of item.dependsOn || []) if (pending.has(dependency)) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of pending.keys()) visit(id);
  return cycles;
}

type SyncBatchResult = { id: string; ok: boolean; status: number; payload?: unknown; requestId?: string | null; conflictId?: string | null; conflict?: unknown };
type SyncBatchResponse = { ok: boolean; serverTime?: string; results: SyncBatchResult[] };

async function applyReplayResult(item: OfflineMutationRecord, result: SyncBatchResult) {
  if (result.ok) {
    await removeOfflineMutation(item.id);
    invalidateMutationCache(item.path);
    invalidateMutationQueries(item.invalidatePaths);
    return "ok" as const;
  }
  const payload = result.payload;
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const message = String(record?.error || record?.message || `Synchronization failed (${result.status}).`);
  if (result.conflictId || [404, 409, 412].includes(result.status)) {
    const conflictId = String(result.conflictId || record?.conflictId || record?.id || "") || null;
    const conflictDetail = result.conflict && typeof result.conflict === "object" ? result.conflict as Record<string, unknown> : {};
    const classification = String(conflictDetail.classification || "").toUpperCase();
    const conflictKind = result.status === 404 || classification.includes("DELETED")
      ? "deleted"
      : classification.includes("PERMISSION")
        ? "permission"
        : classification.includes("VALIDATION")
          ? "validation"
          : "revision";
    const conflictPayload = { ...conflictDetail, serverPayload: payload };
    await updateOfflineMutation(item.id, { status: "conflict", lastError: message, conflictPayload, conflictId, conflictKind });
    return "conflict" as const;
  }
  if (result.status === 401) {
    await updateOfflineMutation(item.id, { status: "paused", pausedAt: Date.now(), pauseReason: "auth", lastError: "Sign in again to resume this queued change." });
    return "stop" as const;
  }
  if ([400, 403, 404, 405, 422].includes(result.status)) {
    await updateOfflineMutation(item.id, { status: "failed", pauseReason: null, conflictKind: result.status === 403 ? "permission" : item.conflictKind || null, lastError: message });
    return result.status === 403 ? "stop" as const : "failed" as const;
  }
  await updateOfflineMutation(item.id, {
    status: "pending",
    lastError: message,
    nextAttemptAt: Date.now() + retryDelay(item.attempts + 1),
  });
  return "stop" as const;
}

async function replaySequentially(items: OfflineMutationRecord[]) {
  for (const item of items) {
    if (shouldQuarantineMutation(item.attempts, item.maxAttempts || 8)) {
      await updateOfflineMutation(item.id, { status: "failed", lastError: "Replay stopped after repeated failures. Review or discard this queued change.", quarantinedAt: Date.now() });
      continue;
    }
    try {
      const headers = new Headers(item.headers || {});
      headers.set("X-Cluster-Idempotency-Key", item.idempotencyKey);
      await api(item.path, {
        method: item.method,
        headers,
        body: item.body === undefined ? undefined : JSON.stringify(item.body),
        skipCacheInvalidation: true,
      });
      await removeOfflineMutation(item.id);
      invalidateMutationCache(item.path);
      invalidateMutationQueries(item.invalidatePaths);
    } catch (error) {
      if (error instanceof ApiError && [404, 409, 412].includes(error.status)) {
        const payload = error.payload && typeof error.payload === "object" ? error.payload as Record<string, unknown> : null;
        await updateOfflineMutation(item.id, {
          status: "conflict",
          lastError: error.message,
          conflictPayload: { serverPayload: error.payload, localSnapshot: item.localSnapshot || item.body, baseSnapshot: item.baseSnapshot || null },
          conflictId: String(payload?.conflictId || payload?.id || "") || null,
          conflictKind: error.status === 404 ? "deleted" : "revision",
        });
        continue;
      }
      if (error instanceof ApiError && error.status === 401) {
        await updateOfflineMutation(item.id, { status: "paused", pausedAt: Date.now(), pauseReason: "auth", lastError: "Sign in again to resume this queued change." });
        break;
      }
      if (error instanceof ApiError && [400, 403, 405, 422].includes(error.status)) {
        await updateOfflineMutation(item.id, { status: "failed", pauseReason: null, conflictKind: error.status === 403 ? "permission" : item.conflictKind || null, lastError: error.message });
        if (error.status === 403) break;
        continue;
      }
      await updateOfflineMutation(item.id, { status: "pending", lastError: error instanceof Error ? error.message : "Connection unavailable.", nextAttemptAt: Date.now() + retryDelay(item.attempts + 1) });
      break;
    }
  }
}


export type ApiOutboxFlushStats = {
  replayed: number;
  remaining: number;
  cap: number;
  capped: boolean;
  dependencyPasses: number;
  durationMs: number;
  completedAt: number;
};

let lastOutboxFlushStats: ApiOutboxFlushStats = { replayed: 0, remaining: 0, cap: 0, capped: false, dependencyPasses: 0, durationMs: 0, completedAt: 0 };

export function getLastApiOutboxFlushStats() { return lastOutboxFlushStats; }

export async function flushApiOutbox(options: { maxMutations?: number } = {}) {
  if (flushPromise) return flushPromise;
  const flushStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  let replayed = 0;
  let remainingAfterFlush = 0;
  let replayCap = OFFLINE_MUTATIONS_PER_FLUSH;
  let dependencyPasses = 0;
  flushPromise = (async () => {
    if (!isOnline()) return listOfflineMutations();
    const initialQueue = await listOfflineMutations();
    const binding = readOfflineServerBinding(getOfflineScope());
    for (const item of initialQueue) {
      if (item.status === "pending") {
        const compatibility = queuedWorkMatchesServerBinding(item, binding);
        if (!compatibility.ok) {
          await updateOfflineMutation(item.id, { status: "paused", pausedAt: Date.now(), pauseReason: "compatibility", lastError: compatibility.reason });
          continue;
        }
      }
      if (item.status === "pending" && shouldQuarantineMutation(item.attempts, item.maxAttempts || 8)) {
        await updateOfflineMutation(item.id, { status: "failed", lastError: "Replay stopped after repeated failures. Review or discard this queued change.", quarantinedAt: Date.now() });
      }
    }

    const maxMutations = Math.max(1, Math.min(OFFLINE_MUTATIONS_PER_FLUSH, Math.floor(options.maxMutations || OFFLINE_MUTATIONS_PER_FLUSH)));
    replayCap = maxMutations;
    let stopReplay = false;

    // Re-read the queue after every batch. This allows A -> B -> C dependency chains to
    // drain in one bounded flush instead of requiring one scheduler cycle per layer.
    while (!stopReplay && replayed < maxMutations) {
      const queue = await listOfflineMutations();
      const unresolvedIds = new Set(queue.map((item) => item.id));
      const ready = queue
        .filter((item) => item.status === "pending" && item.nextAttemptAt <= Date.now() && !(item.dependsOn || []).some((dependency) => unresolvedIds.has(dependency)))
        .slice(0, Math.min(OFFLINE_MUTATION_BATCH_SIZE, maxMutations - replayed));
      if (!ready.length) {
        const cycleIds = dependencyCycleIds(queue);
        if (cycleIds.size) {
          await Promise.all([...cycleIds].map((id) => updateOfflineMutation(id, { status: "failed", conflictKind: "validation", lastError: "This queued change is part of a dependency cycle. Review or discard the related offline changes before retrying." })));
        }
        break;
      }
      dependencyPasses += 1;
      replayed += ready.length;
      await Promise.all(ready.map((item) => updateOfflineMutation(item.id, { status: "replaying", attempts: item.attempts + 1, lastAttemptAt: Date.now(), lastError: null, pauseReason: null })));
      try {
        const response = await rawApi<SyncBatchResponse>("/api/sync/batch", {
          method: "POST",
          body: JSON.stringify({
            deviceId: syncDeviceId(),
            clientVersion: APP_VERSION,
            mutations: ready.map((item) => ({
              id: item.id,
              idempotencyKey: item.idempotencyKey,
              method: item.method,
              path: item.path,
              headers: item.headers || {},
              body: item.body,
              baseRevision: item.baseRevision || undefined,
              schemaVersion: item.mutationSchemaVersion || 0,
            })),
          }),
          skipCacheInvalidation: true,
        });
        const byId = new Map((response.results || []).map((result) => [result.id, result]));
        for (const item of ready) {
          const result = byId.get(item.id);
          if (!result) {
            await updateOfflineMutation(item.id, { status: "pending", lastError: "The server did not return a replay result.", nextAttemptAt: Date.now() + retryDelay(item.attempts + 1) });
            stopReplay = true;
            continue;
          }
          if (await applyReplayResult(item, result) === "stop") stopReplay = true;
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await replaySequentially(ready);
          continue;
        }
        const authPaused = error instanceof ApiError && error.status === 401;
        const permissionDenied = error instanceof ApiError && error.status === 403;
        for (const item of ready) {
          await updateOfflineMutation(item.id, authPaused
            ? { status: "paused", pausedAt: Date.now(), pauseReason: "auth", lastError: "Sign in again to resume this queued change." }
            : permissionDenied
              ? { status: "failed", pauseReason: null, conflictKind: "permission", lastError: error.message }
              : { status: "pending", pauseReason: null, lastError: error instanceof Error ? error.message : "Connection unavailable.", nextAttemptAt: Date.now() + retryDelay(item.attempts + 1) });
        }
        stopReplay = true;
      }
    }
    const remaining = await listOfflineMutations();
    remainingAfterFlush = remaining.filter((item) => item.status === "pending" || item.status === "replaying").length;
    return remaining;
  })().finally(() => {
    const durationMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - flushStartedAt;
    lastOutboxFlushStats = { replayed, remaining: remainingAfterFlush, cap: replayCap, capped: remainingAfterFlush > 0 && replayed >= replayCap, dependencyPasses, durationMs, completedAt: Date.now() };
    recordPerformanceMetric({ name: "offline mutation replay", category: "sync", durationMs, startedAt: Date.now(), detail: { replayed, remaining: remainingAfterFlush, capped: lastOutboxFlushStats.capped, dependencyPasses } });
    flushPromise = null;
  });
  return flushPromise;
}
