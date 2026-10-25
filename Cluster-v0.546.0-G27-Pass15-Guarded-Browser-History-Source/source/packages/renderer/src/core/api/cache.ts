import { recordPerformanceMetric } from "../performance";
import { clearOfflineReadScope, getOfflineScope, invalidateCachedResponses, setOfflineScope, writeCachedResponse } from "../offline-storage";

export type QueryCacheEntry = { value?: unknown; staleAt: number; expiresAt: number; promise?: Promise<unknown>; tags?: string[] };
export const queryCache = new Map<string, QueryCacheEntry>();
const QUERY_CACHE_MAX_ENTRIES = 512;

export function setQueryCache(key: string, entry: QueryCacheEntry) {
  // Search, filters, and inspector routes can generate many unique query strings during
  // a long production session. Keep the hot cache bounded so stale route variants do
  // not accumulate forever. In-flight entries are preserved until they settle.
  if (queryCache.has(key)) queryCache.delete(key);
  queryCache.set(key, entry);
  if (queryCache.size <= QUERY_CACHE_MAX_ENTRIES) return;

  const now = Date.now();
  for (const [candidate, cached] of queryCache) {
    if (queryCache.size <= QUERY_CACHE_MAX_ENTRIES) break;
    if (!cached.promise && cached.expiresAt <= now) queryCache.delete(candidate);
  }
  for (const [candidate, cached] of queryCache) {
    if (queryCache.size <= QUERY_CACHE_MAX_ENTRIES) break;
    if (!cached.promise) queryCache.delete(candidate);
  }
}

export const backgroundRevalidations = new Map<string, Promise<void>>();
let sessionCacheGeneration = 0;
export const CLUSTER_SESSION_INVALIDATED_EVENT = "cluster:session-invalidated";
export function currentSessionCacheGeneration() { return sessionCacheGeneration; }

export type QueryApiOptions = {
  staleMs?: number;
  maxAgeMs?: number;
  force?: boolean;
  signal?: AbortSignal;
  persist?: boolean;
  tags?: string[];
  staleWhileRevalidate?: boolean;
};

function queryPathFromMemoryKey(key: string) {
  const separator = key.indexOf(":/");
  return separator >= 0 ? key.slice(separator + 1) : key;
}

export function invalidateApiQueries(prefix = "") {
  let removed = 0;
  for (const key of [...queryCache.keys()]) {
    if (!prefix || queryPathFromMemoryKey(key).startsWith(prefix)) {
      queryCache.delete(key);
      removed += 1;
    }
  }
  recordPerformanceMetric({
    name: `invalidate ${prefix || "all"}`,
    category: "cache",
    durationMs: 0,
    startedAt: Date.now(),
    detail: { source: "invalidation", mode: prefix ? "prefix" : "all", removed, bypass: true },
  });
  void invalidateCachedResponses((record) => !prefix || record.path.startsWith(prefix));
}

export function setApiQueryData<T>(path: string, value: T, options: Pick<QueryApiOptions, "staleMs" | "maxAgeMs" | "persist" | "tags"> = {}) {
  const staleMs = Math.max(0, options.staleMs ?? 15_000);
  const maxAgeMs = Math.max(staleMs, options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);
  const cachedAt = Date.now();
  const tags = options.tags || [];
  setQueryCache(`${getOfflineScope()}:${path}`, { value, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags });
  if (options.persist !== false) {
    void writeCachedResponse({ path, value, cachedAt, staleAt: cachedAt + staleMs, expiresAt: cachedAt + maxAgeMs, tags });
  }
}

export function invalidateApiQueryTags(tags: string[]) {
  const normalized = new Set(tags.map((tag) => String(tag || "").trim()).filter(Boolean));
  if (!normalized.size) return;
  let removed = 0;
  for (const [key, entry] of [...queryCache.entries()]) {
    if ((entry.tags || []).some((tag) => normalized.has(tag))) {
      queryCache.delete(key);
      removed += 1;
    }
  }
  recordPerformanceMetric({
    name: `invalidate tags`,
    category: "cache",
    durationMs: 0,
    startedAt: Date.now(),
    detail: { source: "invalidation", mode: "tags", removed, tags: [...normalized].join(",").slice(0, 500), bypass: true },
  });
  void invalidateCachedResponses((record) => (record.tags || []).some((tag) => normalized.has(tag)));
}

export async function invalidateAuthenticatedClientState(reason = "session_invalidated") {
  const previousScope = getOfflineScope();
  sessionCacheGeneration += 1;
  queryCache.clear();
  backgroundRevalidations.clear();
  setOfflineScope("anonymous");
  if (typeof window !== "undefined" && (window.clusterDesktop || new URLSearchParams(window.location.search).get("clusterDesktop") === "1")) {
    await import("../desktop").then((desktop) => desktop.clearNativeAuthenticationState()).catch(() => undefined);
  }
  if (previousScope && previousScope !== "anonymous") await clearOfflineReadScope(previousScope).catch(() => undefined);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CLUSTER_SESSION_INVALIDATED_EVENT, { detail: { reason, previousScope } }));
}
