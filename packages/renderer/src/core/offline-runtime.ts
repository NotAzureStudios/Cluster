import { API_URL, api, discardUploadSession, flushApiOutbox, flushApiUploads, getLastApiOutboxFlushStats, requestPauseActiveOfflineUpload, syncDeviceId } from "./api";
import { computeAdaptiveSyncPlan, type AdaptiveSyncMode } from "./adaptive-sync";
import { pullDeltaChanges } from "./delta-sync";
import {
  getOfflineCacheHealth,
  getOfflineQueueCapacity,
  getOfflineScope,
  listOfflineMutations,
  listOfflineUploads,
  pruneOfflineDrafts,
  rebaseOfflineMutation,
  recoverInterruptedOfflineWork,
  removeOfflineMutation,
  removeOfflineUpload,
  subscribeOfflineStorage,
  updateOfflineMutation,
  updateOfflineUpload,
  type OfflineStorageChangeArea,
  type OfflineMutationRecord,
  type OfflineUploadRecord,
} from "./offline-storage";
import { offlineConflictAllowedActions, resolveOfflineConflict, type OfflineConflictAction, type OfflineConflictFieldChoice } from "./offline-conflicts";
import { mayRetryFailedMutation } from "./offline-policy";
export { mayRetryFailedMutation };
import { recordPerformanceMetric } from "./performance";
import { APP_VERSION } from "./version";
import { writeOfflineServerBinding } from "./offline-server-binding";

export type OfflineSyncSnapshot = {
  online: boolean;
  serverReachable: boolean;
  serverState: string;
  readAccessAllowed: boolean;
  mutationReplayAllowed: boolean;
  syncing: boolean;
  uploading: boolean;
  pulling: boolean;
  pending: number;
  paused: number;
  conflicts: number;
  failed: number;
  queuedUploads: number;
  pausedUploads: number;
  failedUploads: number;
  blockedDependencies: number;
  authPaused: number;
  authPausedUploads: number;
  queuedUploadBytes: number;
  queuedUploadByteLimit: number;
  leadership: "leader" | "follower" | "unknown";
  coalescedRefreshes: number;
  catchUpCyclesRemaining: number;
  lastHiddenDurationMs: number | null;
  lastMutationDrainCount: number;
  lastMutationDrainLimit: number | null;
  lastMutationDrainDurationMs: number | null;
  lastMutationDrainAt: number | null;
  queuePressure: "normal" | "busy" | "saturated";
  lastCheckedAt: number | null;
  lastSyncedAt: number | null;
  lastPulledAt: number | null;
  lastPullChanges: number;
  consecutiveFailures: number;
  nextSyncAt: number | null;
  mode: AdaptiveSyncMode;
  deviceId: string | null;
  registeredDevice: { id: string; name?: string | null; platform?: string | null; clientVersion?: string | null; lastSeenAt?: string | null; lastCursor?: string | null } | null;
  serverOpenConflicts: number;
  serverQuarantinedConflicts: number;
  serverResolvedConflicts: number;
  serverReplay24h: number;
  serverReplayFailures24h: number;
  serverOldestOpenConflictAt: string | null;
  lastServerStatusAt: number | null;
  lastError: string | null;
  mutations: OfflineMutationRecord[];
  uploads: OfflineUploadRecord[];
  cache: { entries: number; bytes: number; fresh: number; staleUsable: number; expired: number; oldestCachedAt: number | null; newestCachedAt: number | null } | null;
};

export type OfflineOperationalSnapshot = Pick<OfflineSyncSnapshot,
  "online" | "serverReachable" | "serverState" | "readAccessAllowed" | "mutationReplayAllowed" | "syncing" | "uploading" | "pulling" | "pending" | "paused" | "conflicts" | "failed" | "queuedUploads" | "pausedUploads" | "failedUploads" | "queuePressure" | "lastCheckedAt" | "consecutiveFailures" | "nextSyncAt" | "serverOpenConflicts" | "serverQuarantinedConflicts" | "lastError"
>;

const listeners = new Set<() => void>();
const COMPATIBILITY_CACHE_MS = 60_000;
let compatibilityCache: {
  checkedAt: number;
  healthVersion: string | null;
  proven: boolean;
  readsAllowed: boolean;
  replayAllowed: boolean;
  rejected: boolean;
} | null = null;
let snapshot: OfflineSyncSnapshot = {
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  serverReachable: true,
  serverState: "compatibility-check-pending",
  readAccessAllowed: false,
  mutationReplayAllowed: false,
  syncing: false,
  uploading: false,
  pulling: false,
  pending: 0,
  paused: 0,
  conflicts: 0,
  failed: 0,
  queuedUploads: 0,
  pausedUploads: 0,
  failedUploads: 0,
  blockedDependencies: 0,
  authPaused: 0,
  authPausedUploads: 0,
  queuedUploadBytes: 0,
  queuedUploadByteLimit: 0,
  leadership: "unknown",
  coalescedRefreshes: 0,
  catchUpCyclesRemaining: 0,
  lastHiddenDurationMs: null,
  lastMutationDrainCount: 0,
  lastMutationDrainLimit: null,
  lastMutationDrainDurationMs: null,
  lastMutationDrainAt: null,
  queuePressure: "normal",
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastPulledAt: null,
  lastPullChanges: 0,
  consecutiveFailures: 0,
  nextSyncAt: null,
  mode: "idle",
  deviceId: null,
  registeredDevice: null,
  serverOpenConflicts: 0,
  serverQuarantinedConflicts: 0,
  serverResolvedConflicts: 0,
  serverReplay24h: 0,
  serverReplayFailures24h: 0,
  serverOldestOpenConflictAt: null,
  lastServerStatusAt: null,
  lastError: null,
  mutations: [],
  uploads: [],
  cache: null,
};

function selectOperationalSnapshot(value: OfflineSyncSnapshot): OfflineOperationalSnapshot {
  return {
    online: value.online,
    serverReachable: value.serverReachable,
    serverState: value.serverState,
    readAccessAllowed: value.readAccessAllowed,
    mutationReplayAllowed: value.mutationReplayAllowed,
    syncing: value.syncing,
    uploading: value.uploading,
    pulling: value.pulling,
    pending: value.pending,
    paused: value.paused,
    conflicts: value.conflicts,
    failed: value.failed,
    queuedUploads: value.queuedUploads,
    pausedUploads: value.pausedUploads,
    failedUploads: value.failedUploads,
    queuePressure: value.queuePressure,
    lastCheckedAt: value.lastCheckedAt,
    consecutiveFailures: value.consecutiveFailures,
    nextSyncAt: value.nextSyncAt,
    serverOpenConflicts: value.serverOpenConflicts,
    serverQuarantinedConflicts: value.serverQuarantinedConflicts,
    lastError: value.lastError,
  };
}
function sameOperationalSnapshot(a: OfflineOperationalSnapshot, b: OfflineOperationalSnapshot) {
  return (Object.keys(a) as Array<keyof OfflineOperationalSnapshot>).every((key) => a[key] === b[key]);
}
let operationalSnapshot = selectOperationalSnapshot(snapshot);
let initialized = false;
let authenticatedSession = false;
type SyncRefreshIntent = { flush: boolean; pull: boolean; forceUploads: boolean };
let refreshPromise: Promise<void> | null = null;
let pendingRefreshIntent: SyncRefreshIntent | null = null;
let syncTimer = 0;
let queueRefreshTimer = 0;
let longIdleCatchUpCycles = 0;
let hiddenSince = typeof document !== "undefined" && document.visibilityState === "hidden" ? Date.now() : 0;
let unsubscribeStorage: (() => void) | null = null;
let channel: BroadcastChannel | null = null;
let cleanupRuntimeEvents: (() => void) | null = null;
let queueFingerprint = "";
let uploadFingerprint = "";
const SYNC_LEASE_KEY = "cluster-sync-lease";
const SYNC_LEASE_TTL_MS = 15_000;
const SYNC_CYCLE_MIN_GAP_MS = 45_000;
const syncRuntimeId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sync-${Math.random().toString(36).slice(2)}`;

function sharedSyncCycleKey() {
  return `cluster-sync-cycle:${getOfflineScope()}`;
}

function recentSharedSyncCycle(maxAgeMs = SYNC_CYCLE_MIN_GAP_MS) {
  if (typeof window === "undefined") return false;
  const value = Number(window.localStorage.getItem(sharedSyncCycleKey()) || 0);
  return Number.isFinite(value) && value > 0 && Date.now() - value < maxAgeMs;
}

function markSharedSyncCycle() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(sharedSyncCycleKey(), String(Date.now())); } catch { /* storage pressure must not break sync */ }
}

function broadcastSyncPosture() {
  channel?.postMessage({
    type: "sync-posture",
    posture: {
      online: snapshot.online,
      serverReachable: snapshot.serverReachable,
      serverState: snapshot.serverState,
      readAccessAllowed: snapshot.readAccessAllowed,
      mutationReplayAllowed: snapshot.mutationReplayAllowed,
      lastCheckedAt: snapshot.lastCheckedAt,
      lastSyncedAt: snapshot.lastSyncedAt,
      lastPulledAt: snapshot.lastPulledAt,
      lastPullChanges: snapshot.lastPullChanges,
      lastError: snapshot.lastError,
    },
  });
}

function emit() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(patch: Partial<OfflineSyncSnapshot>) {
  const changed = Object.entries(patch).some(([key, value]) => snapshot[key as keyof OfflineSyncSnapshot] !== value);
  if (!changed) return;
  snapshot = { ...snapshot, ...patch };
  const nextOperational = selectOperationalSnapshot(snapshot);
  if (!sameOperationalSnapshot(operationalSnapshot, nextOperational)) operationalSnapshot = nextOperational;
  emit();
}

export function getOfflineSyncSnapshot() {
  return snapshot;
}

export function getOfflineConnectivitySnapshot() {
  return (snapshot.online ? 1 : 0) | (snapshot.serverReachable ? 2 : 0);
}

export function getOfflineOperationalSnapshot() {
  return operationalSnapshot;
}

export function subscribeOfflineSync(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fingerprintQueue(mutations: OfflineMutationRecord[]) {
  return mutations.map((item) => `${item.id}:${item.status}:${item.updatedAt}:${item.attempts}`).join("|");
}

async function readQueue() {
  const [mutations, uploads, cache, capacity] = await Promise.all([listOfflineMutations(), listOfflineUploads(), getOfflineCacheHealth(), getOfflineQueueCapacity()]);
  const fingerprint = fingerprintQueue(mutations);
  const nextUploadFingerprint = uploads.map((item) => `${item.id}:${item.status}:${item.updatedAt}:${item.attempts}`).join("|");
  let pending = 0;
  let paused = 0;
  let conflicts = 0;
  let failed = 0;
  let authPaused = 0;
  for (const item of mutations) {
    if (item.status === "pending" || item.status === "replaying") pending += 1;
    else if (item.status === "paused") { paused += 1; if (item.pauseReason === "auth") authPaused += 1; }
    else if (item.status === "conflict") conflicts += 1;
    else if (item.status === "failed") failed += 1;
  }
  let queuedUploads = 0;
  let pausedUploads = 0;
  let failedUploads = 0;
  let authPausedUploads = 0;
  for (const item of uploads) {
    if (item.status === "pending" || item.status === "uploading") queuedUploads += 1;
    else if (item.status === "paused") { pausedUploads += 1; if (item.pauseReason === "auth") authPausedUploads += 1; }
    else if (item.status === "failed") failedUploads += 1;
  }
  const unresolvedIds = new Set(mutations.map((item) => item.id));
  const blockedDependencies = mutations.filter((item) => item.status === "pending" && (item.dependsOn || []).some((dependency) => unresolvedIds.has(dependency))).length;
  const queuedWork = pending + paused + queuedUploads + pausedUploads;
  const uploadPressure = capacity.uploads.byteLimit > 0 ? capacity.uploads.bytes / capacity.uploads.byteLimit : 0;
  const counts = {
    pending,
    paused,
    conflicts,
    failed,
    queuedUploads,
    pausedUploads,
    failedUploads,
    blockedDependencies,
    authPaused,
    authPausedUploads,
    queuedUploadBytes: capacity.uploads.bytes,
    queuedUploadByteLimit: capacity.uploads.byteLimit,
    queuePressure: queuedWork >= 1_500 || uploadPressure >= 0.9 ? "saturated" as const : queuedWork >= 250 || uploadPressure >= 0.6 ? "busy" as const : "normal" as const,
  };
  if (fingerprint !== queueFingerprint || nextUploadFingerprint !== uploadFingerprint) {
    queueFingerprint = fingerprint;
    uploadFingerprint = nextUploadFingerprint;
    setSnapshot({ mutations, uploads, cache, ...counts });
  } else {
    setSnapshot({ ...counts, cache });
  }
  return mutations;
}

type ClusterNetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

function networkInformation(): ClusterNetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: ClusterNetworkInformation }).connection;
}

function connectionHints() {
  const connection = networkInformation();
  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType || null,
  };
}

function constrainedUploadConnection() {
  const hints = connectionHints();
  return hints.saveData || ["slow-2g", "2g"].includes(String(hints.effectiveType || ""));
}

function currentPlan() {
  const hints = connectionHints();
  const queuedUploadsForPlan = constrainedUploadConnection() ? 0 : snapshot.queuedUploads;
  return computeAdaptiveSyncPlan({
    online: snapshot.online,
    serverReachable: snapshot.serverReachable,
    pending: snapshot.pending + queuedUploadsForPlan,
    conflicts: snapshot.conflicts,
    failed: snapshot.failed,
    consecutiveFailures: snapshot.consecutiveFailures,
    hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
    saveData: hints.saveData,
    effectiveType: hints.effectiveType,
    lastPullChanges: snapshot.lastPullChanges,
  });
}

function scheduleNextSync(delayOverride?: number) {
  if (!initialized || typeof window === "undefined") return;
  window.clearTimeout(syncTimer);
  const plan = currentPlan();
  const delayMs = Math.max(250, delayOverride ?? plan.delayMs);
  setSnapshot({ mode: plan.mode, nextSyncAt: Date.now() + delayMs });
  syncTimer = window.setTimeout(() => {
    const next = currentPlan();
    void refreshOfflineSyncState({ flush: next.flush, pull: next.pull });
  }, delayMs);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "Synchronization failed.");
}

async function refreshServerSyncPosture() {
  const deviceId = syncDeviceId();
  try {
    const result = await api<{ devices?: Array<{ id: string; name?: string | null; platform?: string | null; clientVersion?: string | null; lastSeenAt?: string | null; lastCursor?: string | null }>; conflicts?: Record<string, number>; replay?: { completed?: number; failed?: number; oldestOpenConflictAt?: string | null } }>(`/api/sync/status?deviceId=${encodeURIComponent(deviceId)}`, { skipCacheInvalidation: true });
    const serverOpenConflicts = Number(result.conflicts?.open || 0);
    const serverQuarantinedConflicts = Number(result.conflicts?.quarantined || 0);
    setSnapshot({
      deviceId,
      registeredDevice: result.devices?.[0] || null,
      serverOpenConflicts,
      serverQuarantinedConflicts,
      serverResolvedConflicts: Number(result.conflicts?.resolved || 0),
      serverReplay24h: Number(result.replay?.completed || 0),
      serverReplayFailures24h: Number(result.replay?.failed || 0),
      serverOldestOpenConflictAt: result.replay?.oldestOpenConflictAt || null,
      lastServerStatusAt: Date.now(),
    });
    if (serverOpenConflicts + serverQuarantinedConflicts > 0) {
      type ServerConflictSummary = { id: string; mutationId: string; classification: string; allowedActions?: string[]; serverPayload?: unknown };
      const readServerConflicts = async (status: "OPEN" | "QUARANTINED") => {
        const page = await api<{ items?: ServerConflictSummary[] } | ServerConflictSummary[]>(`/api/sync/conflicts?deviceId=${encodeURIComponent(deviceId)}&status=${status}&limit=200`, { skipCacheInvalidation: true }).catch(() => ({ items: [] as ServerConflictSummary[] }));
        return Array.isArray(page) ? page : page.items || [];
      };
      const [openConflicts, quarantinedConflicts] = await Promise.all([readServerConflicts("OPEN"), readServerConflicts("QUARANTINED")]);
      const serverConflicts = [...openConflicts, ...quarantinedConflicts];
      if (serverConflicts.length) {
        const local = await listOfflineMutations();
        const localById = new Map(local.map((item) => [item.id, item]));
        let repaired = false;
        for (const conflict of serverConflicts) {
          const item = localById.get(String(conflict.mutationId));
          const allowedActions = Array.isArray(conflict.allowedActions) ? conflict.allowedActions.map(String) : [];
          // Even a discard-only server conflict retains the local work until the user
          // explicitly chooses Discard. Never erase the only draft during background polling.
          if (!item) continue;
          if (item.status === "conflict" && item.conflictId === String(conflict.id) &&
              JSON.stringify((item.conflictPayload as { allowedActions?: string[] } | null)?.allowedActions || []) === JSON.stringify(allowedActions)) continue;
          const classification = String(conflict.classification || "").toUpperCase();
          await updateOfflineMutation(item.id, {
            status: "conflict",
            conflictId: String(conflict.id || "") || null,
            conflictKind: classification.includes("DELETED") ? "deleted" : classification.includes("PERMISSION") ? "permission" : classification.includes("VALIDATION") || classification.includes("SCHEMA") ? "validation" : "revision",
            conflictPayload: { classification: conflict.classification, allowedActions, serverPayload: conflict.serverPayload },
            lastError: item.lastError || "The server recorded a synchronization conflict for this queued change.",
          });
          repaired = true;
        }
        if (repaired) await readQueue();
      }
    }
  } catch {
    setSnapshot({ deviceId, lastServerStatusAt: Date.now() });
  }
}

async function checkServer() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setSnapshot({ online: false, serverReachable: false, serverState: "offline", readAccessAllowed: false, mutationReplayAllowed: false, lastCheckedAt: Date.now() });
    return false;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${API_URL}/health`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { state?: unknown; version?: unknown } | null;
    const serverState = String(payload?.state || response.headers.get("x-cluster-server-state") || "unknown").toLowerCase();
    const healthVersion = String(payload?.version || "").trim() || null;
    const reachable = response.ok;
    let compatibilityProven = false;
    let compatibilityRejected = false;
    let compatibilityReadsAllowed = false;
    let compatibilityReplayAllowed = false;
    const cachedCompatibility = compatibilityCache && Date.now() - compatibilityCache.checkedAt < COMPATIBILITY_CACHE_MS && compatibilityCache.healthVersion === healthVersion
      ? compatibilityCache
      : null;
    if (reachable && cachedCompatibility) {
      compatibilityProven = cachedCompatibility.proven;
      compatibilityRejected = cachedCompatibility.rejected;
      compatibilityReadsAllowed = cachedCompatibility.readsAllowed;
      compatibilityReplayAllowed = cachedCompatibility.replayAllowed;
    } else if (reachable) {
      try {
        const compatibilityResponse = await fetch(`${API_URL}/api/meta/compatibility?clientVersion=${encodeURIComponent(APP_VERSION)}`, { credentials: "include", cache: "no-store", signal: controller.signal });
        if (compatibilityResponse.ok) {
          const compatibility = await compatibilityResponse.json() as { compatible?: unknown; serverInstanceId?: unknown; serverDataEpoch?: unknown; serverVersion?: unknown; contractVersion?: unknown; mutationSchemaVersion?: unknown; runtimeAccess?: { readsAllowed?: unknown; queuedMutationReplayAllowed?: unknown } };
          compatibilityProven = compatibility.compatible === true;
          compatibilityRejected = compatibility.compatible === false;
          compatibilityReadsAllowed = compatibilityProven && compatibility.runtimeAccess?.readsAllowed !== false;
          compatibilityReplayAllowed = compatibilityProven && compatibility.runtimeAccess?.queuedMutationReplayAllowed === true;
          compatibilityCache = { checkedAt: Date.now(), healthVersion, proven: compatibilityProven, rejected: compatibilityRejected, readsAllowed: compatibilityReadsAllowed, replayAllowed: compatibilityReplayAllowed };
          writeOfflineServerBinding(getOfflineScope(), {
            serverInstanceId: String(compatibility.serverInstanceId || "").trim() || null,
            serverDataEpoch: String(compatibility.serverDataEpoch || "").trim() || null,
            serverVersion: String(compatibility.serverVersion || "").trim() || null,
            contractVersion: String(compatibility.contractVersion || "").trim() || null,
            mutationSchemaVersion: Number.isInteger(Number(compatibility.mutationSchemaVersion)) ? Number(compatibility.mutationSchemaVersion) : null,
          });
        } else if (compatibilityResponse.status === 426) {
          compatibilityRejected = true;
        }
      } catch {
        compatibilityCache = null;
        // Reachability is still authoritative; reads/replay stay held until compatibility is proven again.
      }
    }
    const effectiveServerState = reachable && !compatibilityProven && ["healthy", "degraded"].includes(serverState)
      ? compatibilityRejected ? "incompatible" : "compatibility-check-pending"
      : serverState;
    const readAccessAllowed = reachable && compatibilityReadsAllowed && !["maintenance", "recovery", "draining", "starting", "unavailable"].includes(serverState);
    const mutationReplayAllowed = reachable && compatibilityReplayAllowed && ["healthy", "degraded"].includes(serverState);
    setSnapshot({ online: true, serverReachable: reachable, serverState: effectiveServerState, readAccessAllowed, mutationReplayAllowed, lastCheckedAt: Date.now() });
    return reachable;
  } catch {
    setSnapshot({ online: true, serverReachable: false, serverState: "unreachable", readAccessAllowed: false, mutationReplayAllowed: false, lastCheckedAt: Date.now() });
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function mergeRefreshIntent(current: SyncRefreshIntent | null, next: SyncRefreshIntent): SyncRefreshIntent {
  return {
    flush: Boolean(current?.flush || next.flush),
    pull: Boolean(current?.pull || next.pull),
    forceUploads: Boolean(current?.forceUploads || next.forceUploads),
  };
}

function readSyncLease() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SYNC_LEASE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { owner?: string; expiresAt?: number };
    return value.owner && Number(value.expiresAt || 0) > Date.now() ? { owner: value.owner, expiresAt: Number(value.expiresAt) } : null;
  } catch { return null; }
}

async function withSyncLeadership<T>(task: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("cluster-sync", { ifAvailable: true }, async (lock) => {
      if (!lock) { setSnapshot({ leadership: "follower" }); return null; }
      setSnapshot({ leadership: "leader" });
      try { return await task(); } finally { setSnapshot({ leadership: "unknown" }); }
    });
  }
  // Without Web Locks, browser storage is a best-effort coordination channel,
  // not an atomic mutex. Never execute a replay completely unlocked when
  // storage writes fail, and never allow a stopped heartbeat to steal leadership.
  if (typeof window === "undefined") return task();
  const current = readSyncLease();
  if (current && current.owner !== syncRuntimeId) { setSnapshot({ leadership: "follower" }); return null; }
  let lostLeadership = false;
  const renew = (first = false) => {
    try {
      const existing = readSyncLease();
      if ((existing && existing.owner !== syncRuntimeId) || (!first && (!existing || existing.owner !== syncRuntimeId))) {
        lostLeadership = true;
        return false;
      }
      window.localStorage.setItem(SYNC_LEASE_KEY, JSON.stringify({ owner: syncRuntimeId, expiresAt: Date.now() + SYNC_LEASE_TTL_MS }));
      if (readSyncLease()?.owner !== syncRuntimeId) { lostLeadership = true; return false; }
      return true;
    } catch {
      lostLeadership = true;
      return false;
    }
  };
  try {
    if (!renew(true)) {
      setSnapshot({ leadership: "follower", lastError: "Sync coordination is unavailable. Queued work was preserved; automatic replay is paused." });
      return null;
    }
    setSnapshot({ leadership: "leader" });
    const heartbeat = window.setInterval(() => { if (!lostLeadership) renew(); }, Math.floor(SYNC_LEASE_TTL_MS / 3));
    try {
      // The fallback is fenced at the start and before each queued replay.
      // The canonical browser path remains navigator.locks, which is atomic.
      return await task();
    } finally { window.clearInterval(heartbeat); }
  } finally {
    if (readSyncLease()?.owner === syncRuntimeId) window.localStorage.removeItem(SYNC_LEASE_KEY);
    setSnapshot({ leadership: "unknown" });
  }
}

async function performOfflineRefresh(intent: SyncRefreshIntent) {
  await readQueue();
  const urgent = Boolean(snapshot.pending || snapshot.queuedUploads || intent.forceUploads);
  if (!urgent && recentSharedSyncCycle()) return;
  await withSyncLeadership(async () => {
    // Recheck after acquiring leadership: another tab may have completed an idle cycle
    // while this one was waiting for the same browser lock.
    if (!urgent && recentSharedSyncCycle()) return;
    markSharedSyncCycle();
    const reachable = await checkServer();
    if (!reachable) {
      setSnapshot({ consecutiveFailures: snapshot.consecutiveFailures + 1, lastError: snapshot.online ? "Cluster server is unavailable." : null });
      broadcastSyncPosture();
      return;
    }
    setSnapshot({
      consecutiveFailures: 0,
      lastError: snapshot.mutationReplayAllowed
        ? null
        : snapshot.readAccessAllowed
          ? `Cluster is ${snapshot.serverState}; queued changes are being held until writes are safe.`
          : `Cluster is ${snapshot.serverState}; sync is paused until workspace access resumes.`,
    });
    if (!authenticatedSession) {
      setSnapshot({
        readAccessAllowed: false,
        mutationReplayAllowed: false,
        registeredDevice: null,
        lastError: null,
      });
      broadcastSyncPosture();
      return;
    }
    const leadershipSafe = () => typeof navigator !== "undefined" && Boolean(navigator.locks?.request) || readSyncLease()?.owner === syncRuntimeId;
    if (intent.flush && !leadershipSafe()) {
      setSnapshot({ lastError: "Sync leadership was lost. Queued changes are preserved for a later retry." });
      broadcastSyncPosture();
      return;
    }
    if (intent.flush && snapshot.mutationReplayAllowed && snapshot.queuedUploads && (!constrainedUploadConnection() || intent.forceUploads)) {
      setSnapshot({ uploading: true });
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      try { await flushApiUploads(); } finally {
        setSnapshot({ uploading: false });
        recordPerformanceMetric({ name: "offline upload flush", category: "sync", durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt, startedAt: Date.now(), detail: { queued: snapshot.queuedUploads, forced: intent.forceUploads } });
        await readQueue();
      }
    }
    if (intent.flush && !leadershipSafe()) {
      setSnapshot({ lastError: "Sync leadership changed before queued edits could replay. Work was preserved." });
      broadcastSyncPosture();
      return;
    }
    if (intent.flush && snapshot.mutationReplayAllowed && snapshot.pending) {
      setSnapshot({ syncing: true });
      try {
        const catchUpLimit = longIdleCatchUpCycles > 0 ? 40 : null;
        await flushApiOutbox(catchUpLimit ? { maxMutations: catchUpLimit } : undefined);
        const drain = getLastApiOutboxFlushStats();
        if (longIdleCatchUpCycles > 0) longIdleCatchUpCycles -= 1;
        setSnapshot({
          lastSyncedAt: Date.now(),
          catchUpCyclesRemaining: longIdleCatchUpCycles,
          lastMutationDrainCount: drain.replayed,
          lastMutationDrainLimit: catchUpLimit,
          lastMutationDrainDurationMs: drain.durationMs,
          lastMutationDrainAt: drain.completedAt || Date.now(),
        });
        channel?.postMessage({ type: "outbox-flushed", replayed: drain.replayed, remaining: drain.remaining, catchUpCyclesRemaining: longIdleCatchUpCycles });
      } finally {
        setSnapshot({ syncing: false });
        await readQueue();
      }
    }
    if (intent.pull && snapshot.readAccessAllowed) {
      setSnapshot({ pulling: true });
      try {
        const result = await pullDeltaChanges();
        setSnapshot({ lastPulledAt: Date.now(), lastPullChanges: result.changes });
        channel?.postMessage({ type: "delta-pulled", changes: result.changes });
      } finally { setSnapshot({ pulling: false }); }
    }
    const serverPostureStale = !snapshot.lastServerStatusAt || Date.now() - snapshot.lastServerStatusAt >= 5 * 60_000;
    const serverConflictActive = snapshot.serverOpenConflicts > 0 || snapshot.serverQuarantinedConflicts > 0;
    if (urgent || serverConflictActive || serverPostureStale) await refreshServerSyncPosture();
    broadcastSyncPosture();
  });
}

export async function refreshOfflineSyncState(options: { flush?: boolean; pull?: boolean; forceUploads?: boolean } = {}) {
  const intent: SyncRefreshIntent = { flush: options.flush === true, pull: options.pull !== false, forceUploads: options.forceUploads === true };
  if (refreshPromise) {
    pendingRefreshIntent = mergeRefreshIntent(pendingRefreshIntent, intent);
    setSnapshot({ coalescedRefreshes: snapshot.coalescedRefreshes + 1 });
    return refreshPromise;
  }
  refreshPromise = (async () => {
    let nextIntent: SyncRefreshIntent | null = intent;
    while (nextIntent) {
      pendingRefreshIntent = null;
      await performOfflineRefresh(nextIntent);
      nextIntent = pendingRefreshIntent;
    }
  })().catch((error) => {
    setSnapshot({ consecutiveFailures: snapshot.consecutiveFailures + 1, lastError: errorMessage(error) });
  }).finally(() => {
    pendingRefreshIntent = null;
    refreshPromise = null;
    scheduleNextSync();
  });
  return refreshPromise;
}

export type OfflineResourceSyncState = {
  state: "synced" | "pending" | "paused" | "syncing" | "conflict" | "failed";
  pending: number;
  paused: number;
  conflicts: number;
  failed: number;
  attempts: number;
  lastError: string | null;
};

export function getOfflineResourceSyncState(resourceKind: string | null | undefined, resourceId: string | null | undefined): OfflineResourceSyncState {
  const kind = String(resourceKind || "").trim();
  const id = String(resourceId || "").trim();
  if (!kind || !id) return { state: "synced", pending: 0, paused: 0, conflicts: 0, failed: 0, attempts: 0, lastError: null };
  const items = snapshot.mutations.filter((item) => item.resourceKind === kind && item.resourceId === id);
  const pending = items.filter((item) => item.status === "pending").length;
  const paused = items.filter((item) => item.status === "paused").length;
  const conflicts = items.filter((item) => item.status === "conflict").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const syncing = items.some((item) => item.status === "replaying");
  const state = conflicts ? "conflict" : failed ? "failed" : syncing ? "syncing" : paused ? "paused" : pending ? "pending" : "synced";
  const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { state, pending, paused, conflicts, failed, attempts: items.reduce((sum, item) => sum + item.attempts, 0), lastError: recent?.lastError || null };
}

export async function pauseOfflineMutation(id: string) {
  const item = (await listOfflineMutations()).find((candidate) => candidate.id === id);
  if (!item || item.status === "replaying" || item.status === "conflict") return;
  await updateOfflineMutation(id, { status: "paused", pausedAt: Date.now(), pauseReason: "manual", lastError: item.lastError || null });
  await readQueue();
}

export async function resumeOfflineMutation(id: string) {
  const item = (await listOfflineMutations()).find((candidate) => candidate.id === id);
  if (!item || item.status !== "paused" || item.pauseReason !== "manual") return;
  await updateOfflineMutation(id, { status: "pending", pausedAt: null, pauseReason: null, nextAttemptAt: Date.now(), lastError: null });
  await readQueue();
  await refreshOfflineSyncState({ flush: true, pull: false });
}

export async function retryAllOfflineFailures() {
  const mutations = await listOfflineMutations();
  // Permanent denial, schema mismatches and quarantined history require explicit
  // review. Bulk retry must not requeue them after access or contracts change.
  for (const item of mutations) if (mayRetryFailedMutation(item)) await rebaseOfflineMutation(item.id);
  const uploads = await listOfflineUploads();
  for (const upload of uploads) if (upload.status === "failed") await updateOfflineUpload(upload.id, { status: "pending", attempts: 0, nextAttemptAt: Date.now(), pausedAt: null, pauseReason: null, lastError: null });
  await readQueue();
  await refreshOfflineSyncState({ flush: true, pull: true, forceUploads: true });
}

export async function pauseOfflineUpload(id: string) {
  const upload = (await listOfflineUploads()).find((candidate) => candidate.id === id);
  if (!upload || !["pending", "uploading"].includes(upload.status)) return;
  if (upload.status === "uploading" && !requestPauseActiveOfflineUpload(id)) {
    // Do not falsify a pause when the transfer was already committing.
    throw new Error("The upload is no longer controlled by this browser session. Refresh its state before retrying.");
  }
  await updateOfflineUpload(id, { status: "paused", pausedAt: Date.now(), pauseReason: "manual" });
  await readQueue();
}

export async function resumeOfflineUpload(id: string) {
  const upload = (await listOfflineUploads()).find((candidate) => candidate.id === id);
  if (!upload || upload.status !== "paused" || upload.pauseReason !== "manual") return;
  await updateOfflineUpload(id, { status: "pending", pausedAt: null, pauseReason: null, nextAttemptAt: Date.now(), lastError: null });
  await readQueue();
  await refreshOfflineSyncState({ flush: true, pull: false, forceUploads: true });
}

export async function retryOfflineMutation(id: string) {
  const item = (await listOfflineMutations()).find((candidate) => candidate.id === id);
  if (!item || !mayRetryFailedMutation(item)) throw new Error("Review this queued change before retrying; a permission denial, conflict or quarantine cannot be bypassed by Retry.");
  await rebaseOfflineMutation(id);
  await refreshOfflineSyncState({ flush: true });
}

export async function discardOfflineMutation(id: string) {
  const item = (await listOfflineMutations()).find((candidate) => candidate.id === id);
  if (!item || item.status === "replaying") return;
  // A registered server conflict is durable evidence. Resolve it first;
  // never strand the server record or erase the only local edit if offline.
  if (item.conflictId) {
    const allowed = offlineConflictAllowedActions(item);
    const action = allowed.includes("discard") ? "discard" : allowed.includes("keep_server") ? "keep_server" : null;
    if (!action) throw new Error("Server conflict cannot be discarded safely. Review this change before removal.");
    await resolveOfflineConflict(item, action);
  } else {
    await removeOfflineMutation(id);
  }
  await readQueue();
  scheduleNextSync(500);
}

export async function resolveQueuedConflict(id: string, action: OfflineConflictAction, fieldChoices: Record<string, OfflineConflictFieldChoice> = {}) {
  const mutation = (await listOfflineMutations()).find((item) => item.id === id);
  if (!mutation) return;
  await resolveOfflineConflict(mutation, action, fieldChoices);
  await readQueue();
  if (!["keep_server", "discard"].includes(action)) await refreshOfflineSyncState({ flush: true, pull: true });
}

export async function discardOfflineUpload(id: string) {
  const upload = (await listOfflineUploads()).find((item) => item.id === id);
  if (!upload) return;
  if (upload.status === "uploading") throw new Error("Pause the active upload and wait for acknowledgement before discarding its saved file.");
  if (upload.uploadSessionId) await discardUploadSession(upload.uploadSessionId);
  await removeOfflineUpload(id);
  await readQueue();
}

export async function retryOfflineUpload(id: string) {
  const upload = (await listOfflineUploads()).find((item) => item.id === id);
  if (!upload || upload.status === "uploading") return;
  await updateOfflineUpload(id, { status: "pending", attempts: 0, nextAttemptAt: Date.now(), pausedAt: null, pauseReason: null, lastError: null });
  await readQueue();
  await refreshOfflineSyncState({ flush: true, pull: false, forceUploads: true });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("/cluster-sw.js", { scope: "/" });
  } catch {
    // Offline API caching still works when the browser blocks service workers.
  }
}

function scheduleQueueRefresh(area: OfflineStorageChangeArea) {
  if (!["mutations", "uploads", "scope", "all"].includes(area) || typeof window === "undefined") return;
  window.clearTimeout(queueRefreshTimer);
  queueRefreshTimer = window.setTimeout(() => {
    void readQueue().then(() => {
      if (snapshot.pending || snapshot.queuedUploads) scheduleNextSync(400);
    });
  }, 120);
}

export function setOfflineRuntimeAuthenticated(authenticated: boolean) {
  const next = authenticated === true;
  if (authenticatedSession === next) return;
  authenticatedSession = next;
  if (!next) {
    setSnapshot({
      registeredDevice: null,
      readAccessAllowed: false,
      mutationReplayAllowed: false,
      serverOpenConflicts: 0,
      serverQuarantinedConflicts: 0,
      serverResolvedConflicts: 0,
      serverReplay24h: 0,
      serverReplayFailures24h: 0,
      serverOldestOpenConflictAt: null,
      lastServerStatusAt: null,
      catchUpCyclesRemaining: 0,
    });
  }
  if (initialized && typeof window !== "undefined") scheduleNextSync(next ? 100 : undefined);
}

export function initializeOfflineRuntime() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  void registerServiceWorker();
  void Promise.all([recoverInterruptedOfflineWork(), pruneOfflineDrafts()])
    .catch(() => [{ mutations: 0, uploads: 0 }, 0] as const)
    .then(() => readQueue())
    .then(() => scheduleNextSync(250));

  const onOnline = () => {
    setSnapshot({ online: true });
    scheduleNextSync(150);
  };
  const onOffline = () => {
    setSnapshot({ online: false, serverReachable: false, serverState: "offline", readAccessAllowed: false, mutationReplayAllowed: false, nextSyncAt: null, mode: "offline" });
    scheduleNextSync();
  };
  const onFocus = () => scheduleNextSync(250);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (!hiddenSince) hiddenSince = Date.now();
      scheduleNextSync();
      return;
    }
    const hiddenFor = hiddenSince ? Date.now() - hiddenSince : 0;
    hiddenSince = 0;
    // Browser timers can be suspended for hours. Pace the first few outbox drains after a long
    // hidden period so focus + visibility + SSE reconciliation cannot create one giant replay burst.
    if (hiddenFor >= 5 * 60_000) longIdleCatchUpCycles = Math.max(longIdleCatchUpCycles, 4);
    setSnapshot({ lastHiddenDurationMs: hiddenFor || null, catchUpCyclesRemaining: longIdleCatchUpCycles });
    scheduleNextSync(250);
  };
  const onConnectionChange = () => scheduleNextSync(250);
  const connection = networkInformation();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  connection?.addEventListener?.("change", onConnectionChange);
  const unsubscribeServerStatus = window.clusterDesktop?.onServerStatus?.((status) => {
    const wasReachable = snapshot.serverReachable;
    const changed = wasReachable !== status.ok;
    const now = Date.now();
    // Native heartbeat updates may arrive much faster than the adaptive sync
    // cadence. Do not emit a React snapshot or reset the sync timer on every
    // identical healthy heartbeat; only transitions warrant an urgent probe.
    if (changed || !snapshot.lastCheckedAt || now - snapshot.lastCheckedAt >= 30_000) {
      setSnapshot({ serverReachable: status.ok, lastCheckedAt: now, lastError: status.ok ? null : status.message });
    }
    if (changed) scheduleNextSync(status.ok ? 100 : 250);
  });

  unsubscribeStorage = subscribeOfflineStorage(scheduleQueueRefresh);
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("cluster-offline");
    channel.addEventListener("message", (event) => {
      const message = event.data as { type?: string; posture?: Partial<OfflineSyncSnapshot> } | null;
      if (message?.type === "sync-posture" && message.posture) setSnapshot(message.posture);
      scheduleQueueRefresh("mutations");
      // Queue events still need prompt replay. A posture-only broadcast already represents a
      // completed network cycle and should not wake every follower tab 500 ms later.
      if (message?.type !== "sync-posture") scheduleNextSync(500);
    });
  }

  cleanupRuntimeEvents = () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    connection?.removeEventListener?.("change", onConnectionChange);
    unsubscribeServerStatus?.();
  };
}

export function disposeOfflineRuntime() {
  if (!initialized || typeof window === "undefined") return;
  initialized = false;
  window.clearTimeout(syncTimer);
  window.clearTimeout(queueRefreshTimer);
  cleanupRuntimeEvents?.();
  cleanupRuntimeEvents = null;
  unsubscribeStorage?.();
  unsubscribeStorage = null;
  channel?.close();
  channel = null;
  if (typeof window !== "undefined" && readSyncLease()?.owner === syncRuntimeId) window.localStorage.removeItem(SYNC_LEASE_KEY);
  longIdleCatchUpCycles = 0;
  hiddenSince = 0;
  setSnapshot({ nextSyncAt: null, catchUpCyclesRemaining: 0 });
}
