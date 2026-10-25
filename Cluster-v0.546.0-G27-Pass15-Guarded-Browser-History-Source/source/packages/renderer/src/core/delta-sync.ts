import { ApiError, api, invalidateApiQueries, invalidateApiQueryTags, resetSyncDeviceId, syncDeviceId } from "./api";
import { clearOfflineReadScope, readOfflineMeta, writeOfflineMeta } from "./offline-storage";

export type DeltaChange = {
  entityType: string;
  entityId: string;
  projectId?: string | null;
  revision?: number | null;
  updatedAt?: string;
  deletedAt?: string;
  deleted?: boolean;
  data?: unknown;
  invalidate?: string[];
};

type DeltaResponse = {
  ok: boolean;
  cursor: string;
  serverTime?: string;
  hasMore?: boolean;
  resetRequired?: boolean;
  resetReason?: string | null;
  scopeDigest?: string;
  changes: DeltaChange[];
};

export type DeltaSyncResult = {
  changes: number;
  coreCursor: string;
  libraryCursor: string;
};

const CORE_CURSOR_KEY = "delta-cursor:core";
const LIBRARY_CURSOR_KEY = "delta-cursor:library";
const DELTA_EVENT = "cluster-delta-applied";
let pullPromise: Promise<DeltaSyncResult> | null = null;
let pendingDeltaChanges: DeltaChange[] = [];
let deltaDispatchHandle = 0;

function flushDeltaDispatch() {
  deltaDispatchHandle = 0;
  if (typeof window === "undefined" || !pendingDeltaChanges.length) return;
  const latest = new Map<string, DeltaChange>();
  pendingDeltaChanges.forEach((change) => latest.set(`${change.entityType}:${change.entityId}`, change));
  pendingDeltaChanges = [];
  window.dispatchEvent(new CustomEvent(DELTA_EVENT, { detail: { changes: [...latest.values()] } }));
}

function dispatchDelta(changes: DeltaChange[]) {
  if (typeof window === "undefined" || !changes.length) return;
  pendingDeltaChanges.push(...changes);
  if (deltaDispatchHandle) return;
  deltaDispatchHandle = window.requestAnimationFrame(flushDeltaDispatch);
}

export function subscribeDeltaChanges(listener: (changes: DeltaChange[]) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => listener(((event as CustomEvent<{ changes?: DeltaChange[] }>).detail?.changes || []));
  window.addEventListener(DELTA_EVENT, handler);
  return () => window.removeEventListener(DELTA_EVENT, handler);
}

function invalidateChanges(changes: DeltaChange[]) {
  const paths = new Set<string>();
  const tags = new Set<string>();
  for (const change of changes) {
    for (const path of change.invalidate || []) paths.add(path);
    tags.add(change.entityType.replace(/_/g, "-"));
    if (change.projectId) tags.add(`project:${change.projectId}`);
    if (change.entityType === "timeline_item") tags.add("timeline");
    if (change.entityType === "card" || change.entityType === "board" || change.entityType === "board_list") tags.add("board");
    if (change.entityType.includes("library")) tags.add("library");
  }
  paths.forEach((path) => invalidateApiQueries(path));
  invalidateApiQueryTags([...tags]);
}

async function pullEndpoint(path: string, cursorKey: string, options: { deviceId?: string } = {}) {
  let cursor = (await readOfflineMeta<string>(cursorKey)) || "";
  const changes: DeltaChange[] = [];
  let scopeReset = false;
  for (let page = 0; page < 8; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const device = options.deviceId ? `&deviceId=${encodeURIComponent(options.deviceId)}` : "";
    const response = await api<DeltaResponse>(`${path}${separator}since=${encodeURIComponent(cursor)}&limit=500${device}`, { skipCacheInvalidation: true });
    if (!scopeReset && response.resetRequired && response.resetReason === "scope_changed") {
      invalidateApiQueries();
      await clearOfflineReadScope();
      cursor = "";
      scopeReset = true;
    }
    changes.push(...(response.changes || []));
    cursor = response.cursor || cursor;
    await writeOfflineMeta(cursorKey, cursor);
    if (response.scopeDigest) await writeOfflineMeta(`${cursorKey}:scope-digest`, response.scopeDigest);
    if (!response.hasMore) break;
  }
  return { cursor, changes, scopeReset };
}

export async function pullDeltaChanges(): Promise<DeltaSyncResult> {
  if (pullPromise) return pullPromise;
  pullPromise = (async () => {
    let deviceId = syncDeviceId();
    let core;
    try {
      core = await pullEndpoint("/api/sync/delta", CORE_CURSOR_KEY, { deviceId });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "SYNC_DEVICE_OWNERSHIP_CONFLICT") throw error;
      deviceId = resetSyncDeviceId();
      core = await pullEndpoint("/api/sync/delta", CORE_CURSOR_KEY, { deviceId });
    }
    const library = await pullEndpoint("/api/library/delta", LIBRARY_CURSOR_KEY);
    const changes = [...core.changes, ...library.changes];
    invalidateChanges(changes);
    dispatchDelta(changes);
    return { changes: changes.length, coreCursor: core.cursor, libraryCursor: library.cursor };
  })().finally(() => {
    pullPromise = null;
  });
  return pullPromise;
}
