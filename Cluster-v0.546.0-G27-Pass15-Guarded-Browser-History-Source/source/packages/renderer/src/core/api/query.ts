import { getOfflineScope, readCachedResponse, writeCachedResponse } from "../offline-storage";
import { recordPerformanceMetric } from "../performance";
import { api } from "./transport";
import { isApiNetworkFailure, isOnline } from "./errors";
import { backgroundRevalidations, currentSessionCacheGeneration, queryCache, setQueryCache, type QueryApiOptions } from "./cache";
import { requiresFreshSearchAuthorization } from "./live-search-authorization";

async function revalidateCachedQuery<T>(path: string, memoryKey: string, options: QueryApiOptions, staleMs: number, maxAgeMs: number) {
  const generation = currentSessionCacheGeneration();
  const existing = backgroundRevalidations.get(memoryKey);
  if (existing) return existing;
  const task = (async () => {
    try {
      const value = await api<T>(path, { signal: options.signal, skipCacheInvalidation: true });
      if (generation !== currentSessionCacheGeneration()) return;
      const cachedAt = Date.now();
      setQueryCache(memoryKey, { value, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags: options.tags || [] });
      if (options.persist !== false) {
        await writeCachedResponse({ path, value, cachedAt, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags: options.tags || [] });
      }
    } catch {
      // Stale data remains usable. The next connectivity check will retry.
    }
  })().finally(() => backgroundRevalidations.delete(memoryKey));
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
  const cached = queryCache.get(memoryKey);
  if (!options.force && cached?.value !== undefined && cached.staleAt > now) {
    recordPerformanceMetric({ name: `cache ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "memory", hit: true, fresh: true } });
    return cached.value as T;
  }
  if (!options.force && cached?.value !== undefined && cached.expiresAt > now && options.staleWhileRevalidate !== false) {
    if (isOnline()) void revalidateCachedQuery<T>(path, memoryKey, options, staleMs, maxAgeMs);
    recordPerformanceMetric({ name: `cache ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "memory", hit: true, fresh: false } });
    return cached.value as T;
  }
  if (!options.force && cached?.promise) {
    recordPerformanceMetric({ name: `dedupe ${path.split("?")[0]}`, category: "cache", durationMs: 0, startedAt: Date.now(), detail: { source: "inflight", hit: true } });
    return cached.promise as Promise<T>;
  }

  const promise = (async () => {
    const durable = persist ? await readCachedResponse(path) : null;
    if (!options.force && durable && durable.expiresAt > Date.now()) {
      const fresh = durable.staleAt > Date.now();
      setQueryCache(memoryKey, { value: durable.value, staleAt: durable.staleAt, expiresAt: durable.expiresAt, tags: durable.tags || options.tags || [] });
      if (!fresh && options.staleWhileRevalidate !== false && isOnline()) {
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
      if (generation !== currentSessionCacheGeneration()) return value;
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
        });
      }
      return value;
    } catch (error) {
      if (durable && durable.expiresAt > Date.now() && isApiNetworkFailure(error)) {
        setQueryCache(memoryKey, { value: durable.value, staleAt: Date.now() + Math.min(staleMs, 5_000), expiresAt: durable.expiresAt, tags: durable.tags || options.tags || [] });
        return durable.value as T;
      }
      throw error;
    }
  })().catch((error) => {
    if (queryCache.get(memoryKey)?.promise === promise) queryCache.delete(memoryKey);
    throw error;
  });

  setQueryCache(memoryKey, { value: cached?.value, staleAt: cached?.staleAt || 0, expiresAt: cached?.expiresAt || 0, promise, tags: options.tags || cached?.tags || [] });
  return promise;
}
