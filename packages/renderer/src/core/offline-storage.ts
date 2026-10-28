export type OfflineCachedResponse = {
  key: string;
  scope: string;
  serverInstanceId?: string | null;
  serverDataEpoch?: string | null;
  serverVersion?: string | null;
  contractVersion?: string | null;
  mutationSchemaVersion?: number | null;
  path: string;
  value: unknown;
  cachedAt: number;
  staleAt: number;
  expiresAt: number;
  tags: string[];
  sizeBytes: number;
};

export type OfflineMutationStatus = "pending" | "paused" | "replaying" | "conflict" | "failed";
export type OfflinePauseReason = "manual" | "auth" | "server" | "compatibility" | null;
export type OfflineMutationSafety = "safe" | "revision_guarded" | "online_only";
export type OfflineConflictStrategy = "manual" | "prefer_local" | "prefer_server";

export type OfflineMutationRecord = {
  id: string;
  idempotencyKey: string;
  scope: string;
  serverInstanceId?: string | null;
  serverDataEpoch?: string | null;
  serverVersion?: string | null;
  contractVersion?: string | null;
  mutationSchemaVersion?: number | null;
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  headers: Record<string, string>;
  body?: unknown;
  label: string;
  dedupeKey?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
  baseRevision?: number | null;
  dependsOn?: string[];
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: OfflineMutationStatus;
  lastError?: string | null;
  conflictPayload?: unknown;
  conflictId?: string | null;
  baseSnapshot?: Record<string, unknown> | null;
  localSnapshot?: Record<string, unknown> | null;
  changedFields?: string[];
  invalidatePaths?: string[];
  safety?: OfflineMutationSafety;
  conflictStrategy?: OfflineConflictStrategy;
  maxAttempts?: number;
  conflictKind?: "revision" | "permission" | "deleted" | "validation" | "unknown" | null;
  quarantinedAt?: number | null;
  lastAttemptAt?: number | null;
  pausedAt?: number | null;
  pauseReason?: OfflinePauseReason;
};

export type OfflineUploadStatus = "pending" | "paused" | "uploading" | "failed";

export type OfflineUploadRecord = {
  id: string;
  idempotencyKey: string;
  scope: string;
  serverInstanceId?: string | null;
  serverDataEpoch?: string | null;
  serverVersion?: string | null;
  contractVersion?: string | null;
  mutationSchemaVersion?: number | null;
  path: string;
  method: "POST" | "PUT";
  headers: Record<string, string>;
  label: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  file: Blob;
  body: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: OfflineUploadStatus;
  lastError?: string | null;
  invalidatePaths?: string[];
  lastAttemptAt?: number | null;
  pausedAt?: number | null;
  pauseReason?: OfflinePauseReason;
  uploadSessionId?: string | null;
  uploadTransferMode?: "cluster" | "direct" | null;
  uploadSessionStartedAt?: number | null;
};

export type OfflineDraftRecord<T = unknown> = {
  key: string;
  scope: string;
  value: T;
  updatedAt: number;
  expiresAt: number;
};

const DB_NAME = "cluster-offline";
const DB_VERSION = 3;
const RESPONSE_STORE = "responses";
const MUTATION_STORE = "mutations";
const UPLOAD_STORE = "uploads";
const DRAFT_STORE = "drafts";
const META_STORE = "meta";
const FALLBACK_PREFIX = "cluster-offline:";
const CHANGE_EVENT = "cluster-offline-state-changed";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TOTAL_RESPONSE_BYTES = 64_000_000;
const MAX_MUTATIONS = 2_000;
const MAX_UPLOADS = 120;
const MAX_UPLOAD_BYTES = 4_000_000_000;
const MAX_DRAFTS = 250;

let databasePromise: Promise<IDBDatabase | null> | null = null;
let activeScope = "anonymous";
let activeScopeGeneration = 0;
let desktopCacheEventsInstalled = false;

function desktopCacheBridge() {
  if (typeof window === "undefined") return null;
  const bridge = window.clusterDesktop;
  return bridge?.offlineCacheGet && bridge.offlineCacheList && bridge.offlineCachePut && bridge.offlineCacheRemove
    ? bridge
    : null;
}

function installDesktopCacheEvents() {
  if (desktopCacheEventsInstalled || typeof window === "undefined" || !window.clusterDesktop?.onOfflineCacheChanged) return;
  desktopCacheEventsInstalled = true;
  window.clusterDesktop.onOfflineCacheChanged((event) => emitChange(event.area));
}

function browserAvailable() {
  return typeof window !== "undefined";
}

function indexedDbAvailable() {
  return browserAvailable() && typeof window.indexedDB !== "undefined";
}

function localStorageAvailable() {
  return browserAvailable() && typeof window.localStorage !== "undefined";
}

export type OfflineStorageChangeArea = "responses" | "mutations" | "uploads" | "drafts" | "meta" | "scope" | "all";

function emitChange(area: OfflineStorageChangeArea = "all") {
  if (!browserAvailable()) return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { area } }));
}

function storageChangeArea(event: Event): OfflineStorageChangeArea {
  if (event instanceof CustomEvent) {
    const area = event.detail?.area;
    if (["responses", "mutations", "uploads", "drafts", "meta", "scope", "all"].includes(area)) return area;
  }
  if (event instanceof StorageEvent) {
    const key = String(event.key || "");
    if (key.endsWith(":scope")) return "scope";
    if (key.includes(`:${MUTATION_STORE}:`)) return "mutations";
    if (key.includes(`:${UPLOAD_STORE}:`)) return "uploads";
    if (key.includes(`:${RESPONSE_STORE}:`)) return "responses";
    if (key.includes(`:${DRAFT_STORE}:`)) return "drafts";
    if (key.includes(`:${META_STORE}:`)) return "meta";
  }
  return "all";
}

export function subscribeOfflineStorage(listener: (area: OfflineStorageChangeArea) => void) {
  if (!browserAvailable()) return () => undefined;
  installDesktopCacheEvents();
  const handler = (event: Event) => listener(storageChangeArea(event));
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// Account scope is renderer-session authority, never a browser-wide preference.
// localStorage is shared by unrelated authenticated tabs: restoring its previous
// value here would let a signed-out/new tab adopt another user's offline cache.
export function setOfflineScope(scope: string | null | undefined) {
  const next = String(scope || "anonymous").trim() || "anonymous";
  // /api/me, session bootstrap and reconnect may repeatedly report the same
  // account. Broadcasting an unchanged scope made every queue subscriber
  // re-read IndexedDB, even though no authentication state had changed.
  if (next === activeScope) return;
  activeScopeGeneration += 1;
  activeScope = next;
  // Erase the old, unsafe browser-wide pointer; never persist a replacement.
  if (localStorageAvailable()) window.localStorage.removeItem?.(`${FALLBACK_PREFIX}scope`);
  emitChange("scope");
}

export function getOfflineScope() {
  return activeScope;
}

/** A revisioned local account identity. Comparing IDs alone is insufficient for
 * queued work that survives a sign-out/sign-in cycle. */
export function getOfflineScopeIdentity(): Readonly<{ scope: string; generation: number }> {
  return { scope: getOfflineScope(), generation: activeScopeGeneration };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (!indexedDbAvailable()) return null;
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESPONSE_STORE)) {
        const store = db.createObjectStore(RESPONSE_STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
        store.createIndex("cachedAt", "cachedAt", { unique: false });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
      let mutationStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        mutationStore = db.createObjectStore(MUTATION_STORE, { keyPath: "id" });
      } else {
        mutationStore = request.transaction!.objectStore(MUTATION_STORE);
      }
      if (!mutationStore.indexNames.contains("scope")) mutationStore.createIndex("scope", "scope", { unique: false });
      if (!mutationStore.indexNames.contains("status")) mutationStore.createIndex("status", "status", { unique: false });
      if (!mutationStore.indexNames.contains("createdAt")) mutationStore.createIndex("createdAt", "createdAt", { unique: false });
      if (!mutationStore.indexNames.contains("dedupeKey")) mutationStore.createIndex("dedupeKey", "dedupeKey", { unique: false });
      if (!mutationStore.indexNames.contains("resourceKind")) mutationStore.createIndex("resourceKind", "resourceKind", { unique: false });
      if (!mutationStore.indexNames.contains("resourceId")) mutationStore.createIndex("resourceId", "resourceId", { unique: false });
      let uploadStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(UPLOAD_STORE)) uploadStore = db.createObjectStore(UPLOAD_STORE, { keyPath: "id" });
      else uploadStore = request.transaction!.objectStore(UPLOAD_STORE);
      if (!uploadStore.indexNames.contains("scope")) uploadStore.createIndex("scope", "scope", { unique: false });
      if (!uploadStore.indexNames.contains("status")) uploadStore.createIndex("status", "status", { unique: false });
      if (!uploadStore.indexNames.contains("createdAt")) uploadStore.createIndex("createdAt", "createdAt", { unique: false });
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        const store = db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function fallbackKey(store: string, key: string) {
  return `${FALLBACK_PREFIX}${store}:${key}`;
}

function readFallback<T>(store: string, key: string): T | null {
  if (!localStorageAvailable()) return null;
  try {
    const value = window.localStorage.getItem(fallbackKey(store, key));
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeFallback(store: string, key: string, value: unknown) {
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.setItem(fallbackKey(store, key), JSON.stringify(value));
  } catch {
    // Storage pressure should not block the application. IndexedDB pruning handles the normal path.
  }
}

function removeFallback(store: string, key: string) {
  if (!localStorageAvailable()) return;
  window.localStorage.removeItem(fallbackKey(store, key));
}

function listFallback<T>(store: string): T[] {
  if (!localStorageAvailable()) return [];
  const prefix = `${FALLBACK_PREFIX}${store}:`;
  const values: T[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
      if (parsed) values.push(parsed as T);
    } catch {
      // Ignore malformed fallback records.
    }
  }
  return values;
}

// An invalidation can overtake a pending IndexedDB open or Desktop bridge
// write. Each scope's generation fences those old writes out of disk cache.
const responseCacheEpochs = new Map<string, number>();
const responseCacheEpoch = (scope: string) => responseCacheEpochs.get(scope) || 0;
function advanceResponseCacheEpoch(scope: string) {
  responseCacheEpochs.set(scope, responseCacheEpoch(scope) + 1);
}

// Invalidation of a durable projection is asynchronous. During that window a
// new page may read the old record from IndexedDB/native storage, even though
// its memory cache was already cleared. Block matching disk reads until the
// deletion commits; a failed deletion fails closed for that scope.
const responseInvalidationsInFlight = new Map<string, Set<(record: OfflineCachedResponse) => boolean>>();
const unsafeResponseReadScopes = new Set<string>();
function eligibleCachedResponse(record: OfflineCachedResponse | null | undefined, scope: string) {
  if (!record || record.scope !== scope || unsafeResponseReadScopes.has(scope)) return null;
  const inFlight = responseInvalidationsInFlight.get(scope);
  if (inFlight && [...inFlight].some((predicate) => predicate(record))) return null;
  return record;
}

export function offlineCacheKey(path: string, scope = getOfflineScope()) {
  return `${scope}:${path}`;
}

export async function readCachedResponse(path: string, scope = getOfflineScope()) {
  const key = offlineCacheKey(path, scope);
  const desktop = desktopCacheBridge();
  if (unsafeResponseReadScopes.has(scope)) return null;
  if (desktop) return eligibleCachedResponse(await desktop.offlineCacheGet!("responses", key) as OfflineCachedResponse | null, scope);
  const db = await openDatabase();
  if (!db) return eligibleCachedResponse(readFallback<OfflineCachedResponse>(RESPONSE_STORE, key), scope);
  try {
    const transaction = db.transaction(RESPONSE_STORE, "readonly");
    return eligibleCachedResponse((await requestResult(transaction.objectStore(RESPONSE_STORE).get(key))) as OfflineCachedResponse | undefined, scope);
  } catch {
    return eligibleCachedResponse(readFallback<OfflineCachedResponse>(RESPONSE_STORE, key), scope);
  }
}

export async function writeCachedResponse(input: Omit<OfflineCachedResponse, "key" | "scope" | "sizeBytes"> & { scope?: string }) {
  const scope = input.scope || getOfflineScope();
  const expectedEpoch = responseCacheEpoch(scope);
  const isCurrent = () => responseCacheEpoch(scope) === expectedEpoch;
  let serialized = "";
  try {
    serialized = JSON.stringify(input.value);
  } catch {
    return;
  }
  const sizeBytes = new Blob([serialized]).size;
  if (sizeBytes > MAX_RESPONSE_BYTES) return;
  const record: OfflineCachedResponse = {
    ...input,
    key: offlineCacheKey(input.path, scope),
    scope,
    sizeBytes,
  };
  const desktop = desktopCacheBridge();
  if (!isCurrent()) return;
  if (desktop) {
    await desktop.offlineCachePut!("responses", record);
    // A desktop bridge can finish after invalidation. Remove an obsolete
    // response rather than re-expose it during the next page navigation.
    if (!isCurrent()) await desktop.offlineCacheRemove?.("responses", record.key);
    else emitChange("responses");
    return;
  }
  const db = await openDatabase();
  if (!isCurrent()) return;
  if (!db) {
    writeFallback(RESPONSE_STORE, record.key, record);
    emitChange("responses");
    return;
  }
  try {
    const transaction = db.transaction(RESPONSE_STORE, "readwrite");
    transaction.objectStore(RESPONSE_STORE).put(record);
    await transactionComplete(transaction);
    scheduleCachedResponsePrune();
    emitChange("responses");
  } catch {
    if (isCurrent()) writeFallback(RESPONSE_STORE, record.key, record);
  }
}

export async function invalidateCachedResponses(predicate?: (record: OfflineCachedResponse) => boolean, scope = getOfflineScope()) {
  // Block late writes which started before this invalidation. All predicates
  // are conservative: losing a fresh cached item is safe; reviving a revoked
  // or edited item is not.
  advanceResponseCacheEpoch(scope);
  const blocker = predicate || (() => true);
  let active = responseInvalidationsInFlight.get(scope);
  if (!active) { active = new Set(); responseInvalidationsInFlight.set(scope, active); }
  active.add(blocker);
  try {
  const desktop = desktopCacheBridge();
  if (desktop) {
    const records = await desktop.offlineCacheList!("responses", scope) as OfflineCachedResponse[];
    const keys = records.filter((record) => !predicate || predicate(record)).map((record) => record.key);
    if (keys.length) {
      if (desktop.offlineCacheRemoveMany) await desktop.offlineCacheRemoveMany("responses", keys);
      else for (const key of keys) await desktop.offlineCacheRemove!("responses", key);
    }
    emitChange("responses");
    return;
  }
  const db = await openDatabase();
  if (!db) {
    for (const record of listFallback<OfflineCachedResponse>(RESPONSE_STORE)) {
      if (record.scope === scope && (!predicate || predicate(record))) removeFallback(RESPONSE_STORE, record.key);
    }
    emitChange("responses");
    return;
  }
  const transaction = db.transaction(RESPONSE_STORE, "readwrite");
  const store = transaction.objectStore(RESPONSE_STORE);
  const records = (await requestResult(store.getAll())) as OfflineCachedResponse[];
  for (const record of records) if (record.scope === scope && (!predicate || predicate(record))) store.delete(record.key);
  await transactionComplete(transaction);
  emitChange("responses");
  } catch (error) {
    // A failed invalidation may leave forbidden data on disk. Until repaired,
    // serve fresh server reads only rather than revive stale persisted data.
    unsafeResponseReadScopes.add(scope);
    throw error;
  } finally {
    active.delete(blocker);
    if (!active.size) responseInvalidationsInFlight.delete(scope);
  }
}

// Cache inserts must not trigger a complete IndexedDB getAll() scan every
// time a widget loads. Bound scans by both elapsed time and write volume.
const RESPONSE_PRUNE_INTERVAL_MS = 30_000;
const RESPONSE_PRUNE_WRITE_BATCH = 16;
let responsePruneLastStartedAt = 0;
let responseWritesSincePrune = 0;
let responsePruneInFlight = false;
function scheduleCachedResponsePrune() {
  responseWritesSincePrune += 1;
  if (responsePruneInFlight) return;
  if (responseWritesSincePrune < RESPONSE_PRUNE_WRITE_BATCH && Date.now() - responsePruneLastStartedAt < RESPONSE_PRUNE_INTERVAL_MS) return;
  responsePruneInFlight = true;
  responseWritesSincePrune = 0;
  responsePruneLastStartedAt = Date.now();
  void pruneCachedResponses().catch(() => undefined).finally(() => {
    responsePruneInFlight = false;
    if (responseWritesSincePrune >= RESPONSE_PRUNE_WRITE_BATCH) {
      // A large batch arrived while the previous scan was in flight.
      responseWritesSincePrune = RESPONSE_PRUNE_WRITE_BATCH - 1;
      scheduleCachedResponsePrune();
    }
  });
}

async function pruneCachedResponses() {
  if (desktopCacheBridge()) return;
  const db = await openDatabase();
  if (!db) return;
  const transaction = db.transaction(RESPONSE_STORE, "readwrite");
  const store = transaction.objectStore(RESPONSE_STORE);
  const records = ((await requestResult(store.getAll())) as OfflineCachedResponse[]).sort((a, b) => b.cachedAt - a.cachedAt);
  let total = 0;
  const now = Date.now();
  for (const record of records) {
    total += record.sizeBytes || 0;
    if (record.expiresAt < now || total > MAX_TOTAL_RESPONSE_BYTES) store.delete(record.key);
  }
  await transactionComplete(transaction);
}

function mergeBodies(current: unknown, next: unknown) {
  if (current && next && typeof current === "object" && typeof next === "object" && !Array.isArray(current) && !Array.isArray(next)) {
    return { ...(current as Record<string, unknown>), ...(next as Record<string, unknown>) };
  }
  return next;
}

export async function queueOfflineMutation(input: Omit<OfflineMutationRecord, "id" | "idempotencyKey" | "scope" | "createdAt" | "updatedAt" | "attempts" | "nextAttemptAt" | "status"> & { scope?: string; id?: string; idempotencyKey?: string }, canCommit: () => boolean = () => true) {
  // An async fallback may finish loading the queue after the user signs out.
  // Refuse to write an old account's mutation into any session's storage.
  if (!canCommit()) throw new Error("Authentication context changed before queuing the offline operation.");
  const now = Date.now();
  const scope = input.scope || getOfflineScope();
  const current = await listOfflineMutations(scope);
  if (!canCommit()) throw new Error("Authentication context changed before queuing the offline operation.");
  const compactable = input.dedupeKey && ["PATCH", "PUT"].includes(input.method);
  const existing = compactable
    ? current.find((item) => item.dedupeKey === input.dedupeKey && item.status === "pending" && item.method === input.method)
    : undefined;
  if (!existing && current.length >= MAX_MUTATIONS) {
    throw new Error(`The offline change queue is full (${MAX_MUTATIONS.toLocaleString()} changes). Synchronize, review, or discard queued work before adding more.`);
  }
  const record: OfflineMutationRecord = existing
    ? {
        ...existing,
        ...input,
        body: mergeBodies(existing.body, input.body),
        baseRevision: existing.baseRevision ?? input.baseRevision ?? null,
        dependsOn: Array.from(new Set([...(existing.dependsOn || []), ...(input.dependsOn || [])])),
        idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
        updatedAt: now,
        nextAttemptAt: now,
        lastError: null,
        pausedAt: null,
        pauseReason: null,
      }
    : {
        ...input,
        id: input.id || `offline-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
        scope,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        nextAttemptAt: now,
        status: "pending",
        pauseReason: null,
      };
  const desktop = desktopCacheBridge();
  if (desktop) {
    if (!canCommit()) throw new Error("Authentication context changed before queuing the offline operation.");
    await desktop.offlineCachePut!("mutations", record);
    await pruneOfflineMutations();
    emitChange("mutations");
    return record;
  }
  const db = await openDatabase();
  if (!db) {
    if (!canCommit()) throw new Error("Authentication context changed before queuing the offline operation.");
    writeFallback(MUTATION_STORE, record.id, record);
    emitChange("mutations");
    return record;
  }
  if (!canCommit()) throw new Error("Authentication context changed before queuing the offline operation.");
  const transaction = db.transaction(MUTATION_STORE, "readwrite");
  transaction.objectStore(MUTATION_STORE).put(record);
  await transactionComplete(transaction);
  await pruneOfflineMutations();
  emitChange("mutations");
  return record;
}

export async function listOfflineMutations(scope = getOfflineScope()) {
  const desktop = desktopCacheBridge();
  if (desktop) {
    const records = await desktop.offlineCacheList!("mutations", scope) as OfflineMutationRecord[];
    return records.sort((a, b) => a.createdAt - b.createdAt);
  }
  const db = await openDatabase();
  const records = db
    ? ((await requestResult(db.transaction(MUTATION_STORE, "readonly").objectStore(MUTATION_STORE).getAll())) as OfflineMutationRecord[])
    : listFallback<OfflineMutationRecord>(MUTATION_STORE);
  return records.filter((item) => item.scope === scope).sort((a, b) => a.createdAt - b.createdAt);
}

/** A queue record can only be modified by its current account. Record IDs are
 * not authority: IndexedDB and local fallback storage are shared by tabs. */
export async function updateOfflineMutation(id: string, patch: Partial<OfflineMutationRecord>) {
  const owner = getOfflineScopeIdentity();
  const current = () => owner.scope === getOfflineScopeIdentity().scope && owner.generation === getOfflineScopeIdentity().generation;
  if (!current()) return null;
  const desktop = desktopCacheBridge();
  if (desktop) {
    const existing = await desktop.offlineCacheGet!("mutations", id) as OfflineMutationRecord | null;
    if (!existing || existing.scope !== owner.scope || !current()) return null;
    const next = { ...existing, ...patch, scope: existing.scope, id, updatedAt: Date.now() };
    if (!current()) return null;
    await desktop.offlineCachePut!("mutations", next);
    if (current()) emitChange("mutations");
    return current() ? next : null;
  }
  const db = await openDatabase();
  if (!current()) return null;
  if (!db) {
    const existing = readFallback<OfflineMutationRecord>(MUTATION_STORE, id);
    if (!existing || existing.scope !== owner.scope || !current()) return null;
    const next = { ...existing, ...patch, scope: existing.scope, id, updatedAt: Date.now() };
    writeFallback(MUTATION_STORE, id, next);
    if (current()) emitChange("mutations");
    return current() ? next : null;
  }
  const transaction = db.transaction(MUTATION_STORE, "readwrite");
  const store = transaction.objectStore(MUTATION_STORE);
  const existing = (await requestResult(store.get(id))) as OfflineMutationRecord | undefined;
  if (!existing || existing.scope !== owner.scope || !current()) return null;
  const next = { ...existing, ...patch, scope: existing.scope, id, updatedAt: Date.now() };
  store.put(next);
  await transactionComplete(transaction);
  if (current()) emitChange("mutations");
  return current() ? next : null;
}

export async function removeOfflineMutation(id: string) {
  const owner = getOfflineScopeIdentity();
  const current = () => owner.scope === getOfflineScopeIdentity().scope && owner.generation === getOfflineScopeIdentity().generation;
  if (!current()) return;
  const desktop = desktopCacheBridge();
  if (desktop) {
    const existing = await desktop.offlineCacheGet!("mutations", id) as OfflineMutationRecord | null;
    if (!existing || existing.scope !== owner.scope || !current()) return;
    await desktop.offlineCacheRemove!("mutations", id);
    if (current()) emitChange("mutations");
    return;
  }
  const db = await openDatabase();
  if (!current()) return;
  if (!db) {
    const existing = readFallback<OfflineMutationRecord>(MUTATION_STORE, id);
    if (!existing || existing.scope !== owner.scope || !current()) return;
    removeFallback(MUTATION_STORE, id);
  } else {
    const transaction = db.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const existing = await requestResult(store.get(id)) as OfflineMutationRecord | undefined;
    if (!existing || existing.scope !== owner.scope || !current()) return;
    store.delete(id);
    await transactionComplete(transaction);
  }
  if (current()) emitChange("mutations");
}

async function pruneOfflineMutations() {
  const records = await listOfflineMutations();
  if (records.length <= MAX_MUTATIONS) return;
  // Never silently prune conflicts or pending production work. Only terminal failed rows
  // can be reclaimed, and new writes are rejected at the hard limit above.
  const removable = records.filter((item) => item.status === "failed" && item.quarantinedAt);
  for (const record of removable.slice(0, records.length - MAX_MUTATIONS)) await removeOfflineMutation(record.id);
}

export async function queueOfflineUpload(input: Omit<OfflineUploadRecord, "id" | "idempotencyKey" | "scope" | "createdAt" | "updatedAt" | "attempts" | "nextAttemptAt" | "status"> & { scope?: string; id?: string; idempotencyKey?: string }, canCommit: () => boolean = () => true) {
  const owner = getOfflineScopeIdentity();
  const scope = input.scope || owner.scope;
  const authorized = () => canCommit() && scope === owner.scope
    && owner.scope === getOfflineScopeIdentity().scope && owner.generation === getOfflineScopeIdentity().generation;
  if (!authorized()) throw new Error("Authentication context changed before queuing the offline upload.");
  const db = await openDatabase();
  if (!db) throw new Error("Offline file uploads require IndexedDB storage.");
  if (!authorized()) throw new Error("Authentication context changed before queuing the offline upload.");
  const current = await listOfflineUploads(scope);
  if (!authorized()) throw new Error("Authentication context changed before queuing the offline upload.");
  const totalBytes = current.reduce((sum, item) => sum + item.sizeBytes, 0);
  if (current.length >= MAX_UPLOADS || totalBytes + input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error("The offline upload queue is full. Connect and synchronize queued files before adding more.");
  }
  const now = Date.now();
  const record: OfflineUploadRecord = {
    ...input,
    id: input.id || `upload-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
    scope,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    status: "pending",
    pauseReason: null,
  };
  if (!authorized()) throw new Error("Authentication context changed before queuing the offline upload.");
  const transaction = db.transaction(UPLOAD_STORE, "readwrite");
  transaction.objectStore(UPLOAD_STORE).put(record);
  await transactionComplete(transaction);
  if (!authorized()) throw new Error("Authentication context changed after the upload was queued; it remains owned by the original account.");
  emitChange("uploads");
  return record;
}

export async function listOfflineUploads(scope = getOfflineScope()) {
  const db = await openDatabase();
  if (!db) return [] as OfflineUploadRecord[];
  const records = await requestResult(db.transaction(UPLOAD_STORE, "readonly").objectStore(UPLOAD_STORE).getAll()) as OfflineUploadRecord[];
  return records.filter((item) => item.scope === scope).sort((a, b) => a.createdAt - b.createdAt);
}

/** File queue mutations are owned by the initiating authenticated session. A
 * stale transfer completion must not mutate a queue entry after sign-out, even
 * when the same account signs back in with a newer generation. */
export async function updateOfflineUpload(id: string, patch: Partial<OfflineUploadRecord>) {
  const owner = getOfflineScopeIdentity();
  const current = () => owner.scope === getOfflineScopeIdentity().scope && owner.generation === getOfflineScopeIdentity().generation;
  if (!current()) return null;
  const db = await openDatabase();
  if (!db || !current()) return null;
  const transaction = db.transaction(UPLOAD_STORE, "readwrite");
  const store = transaction.objectStore(UPLOAD_STORE);
  const existing = await requestResult(store.get(id)) as OfflineUploadRecord | undefined;
  if (!existing || existing.scope !== owner.scope || !current()) return null;
  // Scope is immutable for an existing queue entry.
  const next = { ...existing, ...patch, scope: existing.scope, id, updatedAt: Date.now() };
  store.put(next);
  await transactionComplete(transaction);
  if (current()) emitChange("uploads");
  return current() ? next : null;
}

export async function removeOfflineUpload(id: string) {
  const owner = getOfflineScopeIdentity();
  const current = () => owner.scope === getOfflineScopeIdentity().scope && owner.generation === getOfflineScopeIdentity().generation;
  if (!current()) return;
  const db = await openDatabase();
  if (!db || !current()) return;
  const transaction = db.transaction(UPLOAD_STORE, "readwrite");
  const store = transaction.objectStore(UPLOAD_STORE);
  const existing = await requestResult(store.get(id)) as OfflineUploadRecord | undefined;
  if (!existing || existing.scope !== owner.scope || !current()) return;
  store.delete(id);
  await transactionComplete(transaction);
  if (current()) emitChange("uploads");
}

export async function recoverInterruptedOfflineWork(scope = getOfflineScope()) {
  const now = Date.now();
  const [mutations, uploads] = await Promise.all([listOfflineMutations(scope), listOfflineUploads(scope)]);
  const interruptedMutations = mutations.filter((item) => item.status === "replaying");
  const interruptedUploads = uploads.filter((item) => item.status === "uploading");

  await Promise.all([
    ...interruptedMutations.map((item) => updateOfflineMutation(item.id, {
      status: "pending",
      nextAttemptAt: now,
      pausedAt: null,
      pauseReason: null,
      lastError: item.lastError || "Recovered after an interrupted synchronization attempt.",
    })),
    ...interruptedUploads.map((item) => updateOfflineUpload(item.id, {
      status: "pending",
      nextAttemptAt: now,
      pausedAt: null,
      pauseReason: null,
      lastError: item.lastError || "Recovered after an interrupted upload attempt.",
    })),
  ]);

  return {
    mutations: interruptedMutations.length,
    uploads: interruptedUploads.length,
  };
}

export async function resumeAuthenticationPausedOfflineWork(scope = getOfflineScope()) {
  const [mutations, uploads] = await Promise.all([listOfflineMutations(scope), listOfflineUploads(scope)]);
  const now = Date.now();
  const authMutations = mutations.filter((item) => item.status === "paused" && item.pauseReason === "auth");
  const authUploads = uploads.filter((item) => item.status === "paused" && item.pauseReason === "auth");
  await Promise.all([
    ...authMutations.map((item) => updateOfflineMutation(item.id, { status: "pending", pausedAt: null, pauseReason: null, nextAttemptAt: now, lastError: null })),
    ...authUploads.map((item) => updateOfflineUpload(item.id, { status: "pending", pausedAt: null, pauseReason: null, nextAttemptAt: now, lastError: null })),
  ]);
  return { mutations: authMutations.length, uploads: authUploads.length };
}

export type OfflineQueueCapacity = {
  mutations: { count: number; limit: number };
  uploads: { count: number; limit: number; bytes: number; byteLimit: number };
};

export async function getOfflineQueueCapacity(scope = getOfflineScope()): Promise<OfflineQueueCapacity> {
  const [mutations, uploads] = await Promise.all([listOfflineMutations(scope), listOfflineUploads(scope)]);
  return {
    mutations: { count: mutations.length, limit: MAX_MUTATIONS },
    uploads: { count: uploads.length, limit: MAX_UPLOADS, bytes: uploads.reduce((sum, item) => sum + Math.max(0, Number(item.sizeBytes || 0)), 0), byteLimit: MAX_UPLOAD_BYTES },
  };
}

// Draft writes and clears are logically ordered operations. IndexedDB transactions
// serialize once opened, but opening the database and Desktop bridge IPC are async:
// without a per-key fence an older autosave can land after a successful Create
// or Settings Save removed its draft. Keep the queue per exact account/key.
const draftOperationTails = new Map<string, Promise<void>>();

// Share a scope read lease for ordinary draft/cursor operations and take an
// exclusive lease when clearing the account's read-only local state. This
// prevents in-flight writes in other browser tabs from resurrecting wiped
// drafts. The local promise fallback covers one renderer, not separate native
// processes without a shared Web Locks implementation.
const readScopeTails = new Map<string, Promise<void>>();
async function withReadScopeOperation<T>(scope: string, clearing: boolean, operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return await locks.request(`cluster-offline:read-scope:${scope}`, { mode: clearing ? "exclusive" : "shared" }, async () => await operation());
  }
  const previous = readScopeTails.get(scope) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  readScopeTails.set(scope, tail);
  void tail.then(() => { if (readScopeTails.get(scope) === tail) readScopeTails.delete(scope); });
  return current;
}

function inDraftOrder<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = draftOperationTails.get(storageKey) ?? Promise.resolve();
  const scope = storageKey.split(":", 1)[0];
  const current = previous.catch(() => undefined).then(() => withReadScopeOperation(scope, false, async () => {
    // Browser Web Locks coordinate different tabs, unlike this renderer-local
    // promise chain. Use the *complete* key (no lossy hash collisions). Native
    // Desktop bridges without a shared LockManager retain per-renderer ordering.
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks?.request) {
      return locks.request(`cluster-offline:drafts:${storageKey}`, { mode: "exclusive" }, operation);
    }
    return operation();
  }));
  const tail = current.then(() => undefined, () => undefined);
  draftOperationTails.set(storageKey, tail);
  void tail.then(() => { if (draftOperationTails.get(storageKey) === tail) draftOperationTails.delete(storageKey); });
  return current;
}

/** A stale implicit draft operation must never mutate storage after account
 * transition, including signing out and back into the same account. Callers
 * deliberately targeting another scope may pass it explicitly. */
function draftOwnerIsCurrent(owner: Readonly<{ scope: string; generation: number }>, explicitScope: boolean) {
  const current = getOfflineScopeIdentity();
  return explicitScope || (owner.scope === current.scope && owner.generation === current.generation);
}

export async function saveOfflineDraft<T>(key: string, value: T, options: { scope?: string; ttlMs?: number } = {}) {
  const owner = getOfflineScopeIdentity();
  const explicitScope = options.scope !== undefined;
  const scope = options.scope || owner.scope;
  const record: OfflineDraftRecord<T> = {
    key: `${scope}:${key}`,
    scope,
    value,
    updatedAt: Date.now(),
    expiresAt: Date.now() + Math.max(60_000, options.ttlMs ?? 30 * 24 * 60 * 60 * 1000),
  };
  return inDraftOrder(record.key, async () => {
    if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
    const desktop = desktopCacheBridge();
    if (desktop) {
      // Captured work from another session must not start Desktop IPC.
      if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
      await desktop.offlineCachePut!("drafts", record);
    } else {
      const db = await openDatabase();
      if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
      if (!db) writeFallback(DRAFT_STORE, record.key, record);
      else {
        const transaction = db.transaction(DRAFT_STORE, "readwrite");
        transaction.objectStore(DRAFT_STORE).put(record);
        await transactionComplete(transaction);
        // Pruning is maintenance, not a reason to reject an acknowledged save.
        void pruneOfflineDrafts(scope).catch(() => undefined);
      }
    }
    if (draftOwnerIsCurrent(owner, explicitScope)) emitChange("drafts");
    return record;
  });
}

export async function readOfflineDraft<T>(key: string, scope = getOfflineScope()) {
  const storageKey = `${scope}:${key}`;
  const record = await inDraftOrder(storageKey, async () => {
    const desktop = desktopCacheBridge();
    const db = desktop ? null : await openDatabase();
    return desktop
      ? await desktop.offlineCacheGet!("drafts", storageKey) as OfflineDraftRecord<T> | null
      : db
        ? ((await requestResult(db.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(storageKey))) as OfflineDraftRecord<T> | undefined)
        : readFallback<OfflineDraftRecord<T>>(DRAFT_STORE, storageKey);
  });
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    // Do not clear an updated record without confirming it is still expired.
    await inDraftOrder(storageKey, async () => {
      const desktop = desktopCacheBridge();
      const db = desktop ? null : await openDatabase();
      const latest = desktop
        ? await desktop.offlineCacheGet!("drafts", storageKey) as OfflineDraftRecord<T> | null
        : db
          ? await requestResult(db.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(storageKey)) as OfflineDraftRecord<T> | undefined
          : readFallback<OfflineDraftRecord<T>>(DRAFT_STORE, storageKey);
      if (!latest || latest.expiresAt >= Date.now()) return;
      if (desktop) await desktop.offlineCacheRemove!("drafts", storageKey);
      else if (!db) removeFallback(DRAFT_STORE, storageKey);
      else {
        const tx = db.transaction(DRAFT_STORE, "readwrite");
        tx.objectStore(DRAFT_STORE).delete(storageKey);
        await transactionComplete(tx);
      }
      emitChange("drafts");
    });
    return null;
  }
  return record;
}

export async function clearOfflineDraft(key: string, scope = getOfflineScope()) {
  const owner = getOfflineScopeIdentity();
  const storageKey = `${scope}:${key}`;
  // Explicit clear of another scope is permitted for administrative recovery.
  const explicitScope = scope !== owner.scope;
  return inDraftOrder(storageKey, async () => {
    if (!draftOwnerIsCurrent(owner, explicitScope)) return;
    const desktop = desktopCacheBridge();
    if (desktop) {
      await desktop.offlineCacheRemove!("drafts", storageKey);
    } else {
      const db = await openDatabase();
      if (!draftOwnerIsCurrent(owner, explicitScope)) return;
      if (!db) removeFallback(DRAFT_STORE, storageKey);
      else {
        const transaction = db.transaction(DRAFT_STORE, "readwrite");
        transaction.objectStore(DRAFT_STORE).delete(storageKey);
        await transactionComplete(transaction);
      }
    }
    if (draftOwnerIsCurrent(owner, explicitScope)) emitChange("drafts");
  });
}

/** Bounded maintenance is not authorized to delete a newer autosave. Snapshot
 * candidates first, then re-read each inside the same per-key cross-tab lock
 * used by save and clear. No multi-key lock is held, avoiding deadlocks. */
export async function pruneOfflineDrafts(scope = getOfflineScope()) {
  const owner = getOfflineScopeIdentity();
  const explicitScope = scope !== owner.scope;
  if (!draftOwnerIsCurrent(owner, explicitScope)) return 0;
  const desktop = desktopCacheBridge();
  const db = desktop ? null : await openDatabase();
  if (!draftOwnerIsCurrent(owner, explicitScope)) return 0;
  const records = desktop
    ? (await desktop.offlineCacheList!("drafts", scope) as OfflineDraftRecord[])
    : db
      ? await requestResult(db.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).getAll()) as OfflineDraftRecord[]
      : listFallback<OfflineDraftRecord>(DRAFT_STORE);
  const scoped = records.filter((record) => record.scope === scope).sort((a, b) => b.updatedAt - a.updatedAt);
  const now = Date.now();
  const candidates = scoped.filter((record, index) => record.expiresAt < now || index >= MAX_DRAFTS);
  let removed = 0;
  for (const candidate of candidates) {
    if (!draftOwnerIsCurrent(owner, explicitScope)) break;
    const didRemove = await inDraftOrder(candidate.key, async () => {
      if (!draftOwnerIsCurrent(owner, explicitScope)) return false;
      const current = desktop
        ? await desktop.offlineCacheGet!("drafts", candidate.key) as OfflineDraftRecord | null
        : db
          ? await requestResult(db.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(candidate.key)) as OfflineDraftRecord | undefined
          : readFallback<OfflineDraftRecord>(DRAFT_STORE, candidate.key);
      // A concurrent save may have refreshed a draft selected for pruning.
      if (!current || current.scope !== scope || current.updatedAt !== candidate.updatedAt
        || current.expiresAt !== candidate.expiresAt) return false;
      if (!draftOwnerIsCurrent(owner, explicitScope)) return false;
      if (desktop) await desktop.offlineCacheRemove!("drafts", candidate.key);
      else if (db) {
        const transaction = db.transaction(DRAFT_STORE, "readwrite");
        transaction.objectStore(DRAFT_STORE).delete(candidate.key);
        await transactionComplete(transaction);
      } else removeFallback(DRAFT_STORE, candidate.key);
      return true;
    });
    if (didRemove) removed += 1;
  }
  if (removed && draftOwnerIsCurrent(owner, explicitScope)) emitChange("drafts");
  return removed;
}

export async function readOfflineMeta<T = unknown>(key: string, scope = getOfflineScope()): Promise<T | null> {
  const owner = getOfflineScopeIdentity();
  const explicitScope = scope !== owner.scope;
  const storageKey = `${scope}:${key}`;
  return withReadScopeOperation(scope, false, async () => {
    if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
    const desktop = desktopCacheBridge();
    if (desktop) {
      const record = await desktop.offlineCacheGet!("meta", storageKey) as { value?: T } | null;
      return draftOwnerIsCurrent(owner, explicitScope) ? record?.value ?? null : null;
    }
    const db = await openDatabase();
    if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
    if (!db) return readFallback<{ key: string; scope: string; value: T }>(META_STORE, storageKey)?.value ?? null;
    try {
      const record = await requestResult(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(storageKey)) as { key: string; scope: string; value: T } | undefined;
      return draftOwnerIsCurrent(owner, explicitScope) ? record?.value ?? null : null;
    } catch {
      return draftOwnerIsCurrent(owner, explicitScope)
        ? readFallback<{ key: string; scope: string; value: T }>(META_STORE, storageKey)?.value ?? null
        : null;
    }
  });
}

export async function writeOfflineMeta<T = unknown>(key: string, value: T, scope = getOfflineScope()) {
  const owner = getOfflineScopeIdentity();
  const explicitScope = scope !== owner.scope;
  const storageKey = `${scope}:${key}`;
  if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
  return withReadScopeOperation(scope, false, async () => {
    if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
    const record = { key: storageKey, scope, value, updatedAt: Date.now() };
    const desktop = desktopCacheBridge();
    if (desktop) {
      if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
      await desktop.offlineCachePut!("meta", record);
    } else {
      const db = await openDatabase();
      if (!draftOwnerIsCurrent(owner, explicitScope)) return null;
      if (!db) writeFallback(META_STORE, storageKey, record);
      else {
        const transaction = db.transaction(META_STORE, "readwrite");
        transaction.objectStore(META_STORE).put(record);
        await transactionComplete(transaction);
      }
    }
    if (draftOwnerIsCurrent(owner, explicitScope)) emitChange("meta");
    return record;
  });
}

export async function rebaseOfflineMutation(id: string, revision?: number | null, bodyOverride?: unknown) {
  const records = await listOfflineMutations();
  const existing = records.find((item) => item.id === id);
  if (!existing) return null;
  const currentPayload = existing.conflictPayload && typeof existing.conflictPayload === "object"
    ? existing.conflictPayload as { current?: { revision?: number } }
    : null;
  const nextRevision = Number(revision || currentPayload?.current?.revision || 0);
  const sourceBody = bodyOverride === undefined ? existing.body : bodyOverride;
  const body = nextRevision && sourceBody && typeof sourceBody === "object" && !Array.isArray(sourceBody)
    ? { ...(sourceBody as Record<string, unknown>), expectedRevision: nextRevision }
    : sourceBody;
  return updateOfflineMutation(id, {
    body,
    baseRevision: nextRevision || existing.baseRevision || null,
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    conflictPayload: undefined,
    conflictId: null,
    pausedAt: null,
    pauseReason: null,
  });
}


export async function clearOfflineReadScope(scope = getOfflineScope()) {
  await invalidateCachedResponses(undefined, scope);
  return withReadScopeOperation(scope, true, async () => {
    const desktop = desktopCacheBridge();
    if (desktop) {
      for (const area of ["drafts", "meta"] as const) {
        const records = await desktop.offlineCacheList!(area, scope) as Array<{ key: string; scope?: string }>;
        const keys = records.filter((record) => record.scope === scope || record.key.startsWith(`${scope}:`)).map((record) => record.key);
        if (keys.length && desktop.offlineCacheRemoveMany) await desktop.offlineCacheRemoveMany(area, keys);
        else for (const key of keys) await desktop.offlineCacheRemove!(area, key);
      }
      emitChange("all");
      return;
    }
    const db = await openDatabase();
    if (!db) {
      for (const area of [DRAFT_STORE, META_STORE]) {
        for (const record of listFallback<{ key: string; scope: string }>(area)) {
          if (record.scope === scope) removeFallback(area, record.key);
        }
      }
      emitChange("all");
      return;
    }
    const transaction = db.transaction([DRAFT_STORE, META_STORE], "readwrite");
    for (const area of [DRAFT_STORE, META_STORE]) {
      const store = transaction.objectStore(area);
      const records = (await requestResult(store.getAll())) as Array<{ key: string; scope: string }>;
      for (const record of records) if (record.scope === scope) store.delete(record.key);
    }
    await transactionComplete(transaction);
    emitChange("all");
  });
}

export async function clearOfflineScope(scope = getOfflineScope()) {
  const desktop = desktopCacheBridge();
  if (desktop) {
    await desktop.offlineCacheClearScope!(scope);
    emitChange("all");
    return;
  }
  await invalidateCachedResponses(undefined, scope);
  const db = await openDatabase();
  if (!db) {
    for (const area of [MUTATION_STORE, UPLOAD_STORE, DRAFT_STORE, META_STORE]) {
      for (const record of listFallback<{ id?: string; key?: string; scope: string }>(area)) {
        if (record.scope === scope) removeFallback(area, String(record.id || record.key));
      }
    }
  } else {
    const transaction = db.transaction([MUTATION_STORE, UPLOAD_STORE, DRAFT_STORE, META_STORE], "readwrite");
    for (const area of [MUTATION_STORE, UPLOAD_STORE, DRAFT_STORE, META_STORE]) {
      const store = transaction.objectStore(area);
      const rows = await requestResult(store.getAll()) as Array<{ id?: string; key?: string; scope: string }>;
      for (const row of rows) if (row.scope === scope) store.delete(String(row.id || row.key));
    }
    await transactionComplete(transaction);
  }
  emitChange("all");
}

export type OfflineCacheHealth = {
  scope: string;
  entries: number;
  bytes: number;
  fresh: number;
  staleUsable: number;
  expired: number;
  oldestCachedAt: number | null;
  newestCachedAt: number | null;
};

export async function getOfflineCacheHealth(scope = getOfflineScope()): Promise<OfflineCacheHealth> {
  const desktop = desktopCacheBridge();
  let records: OfflineCachedResponse[] = [];
  if (desktop) {
    records = (await desktop.offlineCacheList!("responses", scope) as OfflineCachedResponse[]).filter((record) => record.scope === scope);
  } else {
    const db = await openDatabase();
    if (!db) records = listFallback<OfflineCachedResponse>(RESPONSE_STORE).filter((record) => record.scope === scope);
    else records = ((await requestResult(db.transaction(RESPONSE_STORE, "readonly").objectStore(RESPONSE_STORE).getAll())) as OfflineCachedResponse[]).filter((record) => record.scope === scope);
  }
  const now = Date.now();
  return {
    scope,
    entries: records.length,
    bytes: records.reduce((sum, record) => sum + Math.max(0, Number(record.sizeBytes || 0)), 0),
    fresh: records.filter((record) => record.staleAt > now).length,
    staleUsable: records.filter((record) => record.staleAt <= now && record.expiresAt > now).length,
    expired: records.filter((record) => record.expiresAt <= now).length,
    oldestCachedAt: records.length ? Math.min(...records.map((record) => Number(record.cachedAt || now))) : null,
    newestCachedAt: records.length ? Math.max(...records.map((record) => Number(record.cachedAt || 0))) : null,
  };
}
