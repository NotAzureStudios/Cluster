import { getOfflineScope, readCachedResponse, writeCachedResponse } from "../offline-storage";
import { recordPerformanceMetric } from "../performance";
import { api } from "./transport";
import { ApiError, isApiNetworkFailure, isOnline } from "./errors";
import { backgroundRevalidations, currentSessionCacheGeneration, queryCache, setQueryCache, type QueryApiOptions } from "./cache";
import { requiresFreshSearchAuthorization } from "./live-search-authorization";

// Explicit refreshes bypass cached values, not the same outstanding network
// request. Keep authorization-sensitive Search excluded from this coalescing.
const forcedReads = new Map<string, Promise<unknown>>();
// After a mutation invalidates an in-flight read, callers must not receive
// the pre-mutation payload. Coalesce one bounded recovery GET per scope/path.
const invalidatedReadRecoveries = new Map<string, Promise<unknown>>();
// A denied background widget read is not a reason to issue the same request
// again on every mount/render. Keep the backoff session- and path-scoped;
// the server remains the authority and explicitly requested reads can retry.
const rateLimitedReads = new Map<string, { until: number; error: ApiError }>();
// A stale cached response should remain instantly usable. Revalidation is a
// background recovery operation, not an excuse to send another GET whenever
// React remounts the page or several widgets share the same dataset.
const backgroundReadAttemptedAt = new Map<string, number>();
const BACKGROUND_REVALIDATION_GAP_MS = 20_000;
function allowBackgroundRevalidation(key: string, now = Date.now()): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  const last = backgroundReadAttemptedAt.get(key) || 0;
  if (now - last < BACKGROUND_REVALIDATION_GAP_MS) return false;
  backgroundReadAttemptedAt.delete(key);
  backgroundReadAttemptedAt.set(key, now);
  if (backgroundReadAttemptedAt.size > 512) {
    const oldest = backgroundReadAttemptedAt.keys().next().value;
    if (oldest) backgroundReadAttemptedAt.delete(oldest);
  }
  return true;
}

/** Read an already-authorized in-memory projection synchronously for instant
 * navigation. This never fetches or extends freshness, and never exposes the
 * authorization-sensitive Command Search cache. */
export function peekApiQuery<T>(path: string): T | null {
  if (requiresFreshSearchAuthorization(path)) return null;
  const entry = queryCache.get(`${getOfflineScope()}:${path}`);
  return entry?.value !== undefined && entry.staleAt > Date.now() && entry.expiresAt > Date.now() ? entry.value as T : null;
}

function rateLimitedRead(key: string, now = Date.now()) {
  const entry = rateLimitedReads.get(key);
  if (!entry) return null;
  if (entry.until > now) return entry;
  rateLimitedReads.delete(key);
  return null;
}
function noteRateLimitedRead(key: string, error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 429) return;
  const wait = Math.max(1_000, Math.min(60_000, Math.ceil((error.retryAfterSeconds ?? 5) * 1_000)));
  rateLimitedReads.set(key, { until: Date.now() + wait, error });
  if (rateLimitedReads.size > 512) {
    const first = rateLimitedReads.keys().next().value;
    if (first) rateLimitedReads.delete(first);
  }
}

async function revalidateCachedQuery<T>(path: string, memoryKey: string, options: QueryApiOptions, staleMs: number, maxAgeMs: number) {
  const generation = currentSessionCacheGeneration();
  const existing = backgroundRevalidations.get(memoryKey);
  if (existing) return existing;
  if (!allowBackgroundRevalidation(`${generation}:${memoryKey}`)) return;
  const observedCache = queryCache.get(memoryKey);
  const task = (async () => {
    try {
      const value = await api<T>(path, { signal: options.signal, skipCacheInvalidation: true });
      rateLimitedReads.delete(`${generation}:${memoryKey}`);
      // A mutation, realtime invalidation, or newer forced read may have
      // replaced this entry while the request was in flight. Never let a
      // delayed background response resurrect obsolete data.
      if (generation !== currentSessionCacheGeneration() || queryCache.get(memoryKey) !== observedCache) return;
      const cachedAt = Date.now();
      setQueryCache(memoryKey, { value, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags: options.tags || [] });
      if (options.persist !== false) {
        await writeCachedResponse({ path, value, cachedAt, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags: options.tags || [] });
      }
    } catch (error) {
      noteRateLimitedRead(`${generation}:${memoryKey}`, error);
      // Stale data remains usable. Respect Retry-After before revalidating it.
    }
  })().finally(() => {
    if (backgroundRevalidations.get(memoryKey) === task) backgroundRevalidations.delete(memoryKey);
  });
  backgroundRevalidations.set(memoryKey, task);
  return task;
}

export async function queryApi<T>(path: string, options: QueryApiOptions = {}): Promise<T> {
  const generation = currentSessionCacheGeneration();
  const staleMs = Math.max(0, options.staleMs ?? 15_000);
  const maxAgeMs = Math.max(staleMs, options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);
  const persist = options.persist !== false;
  const now = Date.now();
  const memoryKey = `${getOfflineScope()}:${path}`;
  const backoffKey = `${generation}:${memoryKey}`;
  // Command Search returns permission-filtered titles, people and private resource IDs.
  // A previously authorized response is never authorization for a subsequent query.
  // Do not use even the memory cache or stale-while-revalidate after a role,
  // membership, folder grant or Packet audience changes on another client.
  // Keep the server's permission-agnostic ranking cache; only result payloads bypass
  // renderer caching. This also covers Search consumers outside the taskbar.
  if (requiresFreshSearchAuthorization(path)) {
    queryCache.delete(memoryKey); // drop any entry left by an older renderer
    return api<T>(path, { signal: options.signal, skipCacheInvalidation: true });
  }
  const forcedKey = `${generation}:${memoryKey}`;
  // Do not share a caller-owned AbortSignal with another caller.
  if (options.force && !options.signal) {
    const existingForce = forcedReads.get(forcedKey);
    if (existingForce) return existingForce as Promise<T>;
  }
  const cached = queryCache.get(memoryKey);
  if (!options.force && cached?.value !== undefined && cached.staleAt > now) {
    recordPerformanceMetric({ name: `cache ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "memory", hit: true, fresh: true } });
    return cached.value as T;
  }
  if (!options.force && cached?.value !== undefined && cached.expiresAt > now && options.staleWhileRevalidate !== false) {
    if (isOnline() && !rateLimitedRead(backoffKey)) void revalidateCachedQuery<T>(path, memoryKey, options, staleMs, maxAgeMs);
    recordPerformanceMetric({ name: `cache ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "memory", hit: true, fresh: false } });
    return cached.value as T;
  }
  if (!options.force && cached?.promise) {
    recordPerformanceMetric({ name: `dedupe ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "inflight", hit: true } });
    return cached.promise as Promise<T>;
  }
  if (!options.force && rateLimitedRead(backoffKey)) throw rateLimitedRead(backoffKey)!.error;

  let promise!: Promise<T>;
  promise = (async (): Promise<T> => {
    // Invalidation can happen while the disk/network read is outstanding.
    // Only the active request may repopulate the shared cache.
    const ownsCacheEntry = () => generation === currentSessionCacheGeneration() && queryCache.get(memoryKey)?.promise === promise;
    // An unavailable, blocked, or corrupt IndexedDB store must not prevent an
    // online GET. Explicit refresh never needs a durable-cache read.
    const durable = persist && !options.force ? await readCachedResponse(path).catch(() => null) : null;
    if (!options.force && durable && durable.expiresAt > Date.now() && ownsCacheEntry()) {
      const fresh = durable.staleAt > Date.now();
      setQueryCache(memoryKey, { value: durable.value, staleAt: durable.staleAt, expiresAt: durable.expiresAt, tags: durable.tags || options.tags || [] });
      if (!fresh && options.staleWhileRevalidate !== false && isOnline() && !rateLimitedRead(backoffKey)) {
        void revalidateCachedQuery<T>(path, memoryKey, options, staleMs, maxAgeMs);
      }
      recordPerformanceMetric({ name: `cache ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "durable", hit: true, fresh } });
      return durable.value as T;
    }

    if (!options.force) {
      recordPerformanceMetric({ name: `cache ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "miss", hit: false } });
    }
    try {
      const value = await api<T>(path, { signal: options.signal, skipCacheInvalidation: true });
      rateLimitedReads.delete(backoffKey);
      if (!ownsCacheEntry()) {
        // Deleting a cache entry prevents stale data from being stored, but
        // returning that response still repaints the active view with data
        // from before the edit. Prefer a newer pending/fresh read, otherwise
        // issue one shared recovery GET. Search and session changes remain
        // governed by their separate authorization paths.
        if (generation !== currentSessionCacheGeneration()) {
          throw new ApiError("The session changed while data was loading.", 409, null, null, "AUTH_CONTEXT_CHANGED");
        }
        if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
        const replacement = queryCache.get(memoryKey);
        if (replacement?.value !== undefined && replacement.staleAt > Date.now()) return replacement.value as T;
        if (replacement?.promise && replacement.promise !== promise) return replacement.promise as Promise<T>;
        const recoveryKey = `${generation}:${memoryKey}`;
        let recovery = invalidatedReadRecoveries.get(recoveryKey) as Promise<T> | undefined;
        if (!recovery) {
          recovery = api<T>(path, { skipCacheInvalidation: true });
          invalidatedReadRecoveries.set(recoveryKey, recovery);
          void recovery.finally(() => {
            if (invalidatedReadRecoveries.get(recoveryKey) === recovery) invalidatedReadRecoveries.delete(recoveryKey);
          }).catch(() => undefined);
        }
        // A caller cancelling navigation must not be held up by another
        // view's recovery or receive its data after unmount.
        if (!options.signal) return recovery;
        return new Promise<T>((resolve, reject) => {
          if (options.signal!.aborted) { reject(new DOMException("Request aborted", "AbortError")); return; }
          const abort = () => { options.signal!.removeEventListener("abort", abort); reject(new DOMException("Request aborted", "AbortError")); };
          options.signal!.addEventListener("abort", abort, { once: true });
          void recovery!.then(
            (result) => { options.signal!.removeEventListener("abort", abort); resolve(result); },
            (error) => { options.signal!.removeEventListener("abort", abort); reject(error); },
          );
        });
      }
      const cachedAt = Date.now();
      setQueryCache(memoryKey, { value, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags: options.tags || [] });
      if (persist) {
        void writeCachedResponse({
          path,
          value,
          cachedAt,
          staleAt: cachedAt + staleMs,
          expiresAt: cachedAt + maxAgeMs,
          tags: options.tags || [],
        }).catch(() => undefined); // blocked/quota-limited IndexedDB cannot fail a successful online GET
      }
      return value;
    } catch (error) {
      noteRateLimitedRead(backoffKey, error);
      if (ownsCacheEntry() && durable && durable.expiresAt > Date.now() && isApiNetworkFailure(error)) {
        setQueryCache(memoryKey, { value: durable.value, staleAt: Date.now() + Math.min(staleMs, 5_000), expiresAt: durable.expiresAt, tags: durable.tags || options.tags || [] });
        return durable.value as T;
      }
      throw error;
    }
  })().catch((error: unknown) => {
    if (queryCache.get(memoryKey)?.promise === promise) queryCache.delete(memoryKey);
    throw error;
  });

  setQueryCache(memoryKey, { value: cached?.value, staleAt: cached?.staleAt || 0, expiresAt: cached?.expiresAt || 0, promise, tags: options.tags || cached?.tags || [] });
  if (options.force && !options.signal) {
    forcedReads.set(forcedKey, promise);
    void promise.finally(() => {
      if (forcedReads.get(forcedKey) === promise) forcedReads.delete(forcedKey);
    }).catch(() => undefined);
  }
  return promise;
}
