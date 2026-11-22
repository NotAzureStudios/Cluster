import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, mutateApi, queryApi } from "./api";
import { getOfflineScopeIdentity } from "./offline-storage";
import { mayApplyClientState } from "./user-state-ownership";

export type ServerStateScope = "user" | "studio";
export type ServerStateRecord<T> = {
  id: string;
  scope: ServerStateScope;
  key: string;
  payload: T;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type StateResponse<T> = { ok: true; record: ServerStateRecord<T> | null };
type MutationResponse<T> = { ok: true; record: ServerStateRecord<T> };

type UseServerStateOptions<T> = {
  merge?: (serverValue: T, fallback: T) => T;
  enabled?: boolean;
};

function statePath(scope: ServerStateScope, key: string) {
  return `/api/client-state/${scope}/${encodeURIComponent(key)}`;
}

// Collapse simultaneous user preference hydration into one authorized read.
// Studio keys retain their individually authorized endpoints: the studio-wide
// collection endpoint requires admin privileges and is not permission-equivalent.
type UserStateWaiter = {
  key: string;
  resolve: (response: StateResponse<unknown>) => void;
  reject: (error: unknown) => void;
};
const pendingUserStateReads = new Map<string, UserStateWaiter[]>();
function batchUserStateRead<T>(key: string): Promise<StateResponse<T>> {
  const identity = getOfflineScopeIdentity();
  const ownerKey = `${identity.scope}:${identity.generation}`;
  return new Promise<StateResponse<T>>((resolve, reject) => {
    const queue = pendingUserStateReads.get(ownerKey) || [];
    queue.push({ key, resolve: resolve as (response: StateResponse<unknown>) => void, reject });
    if (!pendingUserStateReads.has(ownerKey)) {
      pendingUserStateReads.set(ownerKey, queue);
      queueMicrotask(() => {
        const waiting = pendingUserStateReads.get(ownerKey) || [];
        pendingUserStateReads.delete(ownerKey);
        // Do not issue an old account's preference fetch after ownership changes.
        const current = getOfflineScopeIdentity();
        if (`${current.scope}:${current.generation}` !== ownerKey) {
          for (const item of waiting) item.resolve({ ok: true, record: null });
          return;
        }
        const byKey = new Map<string, UserStateWaiter[]>();
        for (const item of waiting) byKey.set(item.key, [...(byKey.get(item.key) || []), item]);
        const keys = [...byKey.keys()];
        for (let offset = 0; offset < keys.length; offset += 24) {
          const selection = keys.slice(offset, offset + 24);
          // No force: batching only collapses the readers that land in the same
          // microtask, so a second mount wave a few hundred milliseconds later
          // used to re-request the identical key set. staleMs is what makes
          // that second wave free, and writeServerState invalidates the
          // "client-state" tag, so an edit still refreshes immediately.
          void queryApi<{ records: ServerStateRecord<unknown>[] }>(
            `/api/client-state/user?keys=${selection.map(encodeURIComponent).join(",")}`,
            { staleMs: 10_000, tags: ["client-state", "user-preferences"] },
          ).then((result) => {
            const records = new Map((result.records || []).map((record) => [record.key, record]));
            for (const name of selection) for (const item of byKey.get(name) || [])
              item.resolve({ ok: true, record: records.get(name) || null });
          }).catch((error) => {
            for (const name of selection) for (const item of byKey.get(name) || []) item.reject(error);
          });
        }
      });
    }
  });
}

export async function readServerState<T>(scope: ServerStateScope, key: string, fallback: T, force = false) {
  const owner = getOfflineScopeIdentity();
  if (!mayApplyClientState(scope, owner, getOfflineScopeIdentity())) return fallback;
  const result = await queryApi<StateResponse<T>>(statePath(scope, key), {
    force,
    staleMs: 10_000,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    tags: ["client-state", `${scope}:${key}`],
  });
  return mayApplyClientState(scope, owner, getOfflineScopeIdentity()) ? result.record?.payload ?? fallback : fallback;
}

export async function writeServerState<T>(scope: ServerStateScope, key: string, payload: T, expectedRevision?: number | null, expectedOwner = getOfflineScopeIdentity(), onQueued?: () => void) {
  // Never replay an old account's revision under a new authenticated session.
  if (!mayApplyClientState(scope, expectedOwner, getOfflineScopeIdentity())) return null;
  const write = async (revision: number | null | undefined) => {
    if (!mayApplyClientState(scope, expectedOwner, getOfflineScopeIdentity())) return null;
    const result = await mutateApi<MutationResponse<T>>(statePath(scope, key), {
      method: "PUT",
      body: { payload, ...(revision != null ? { expectedRevision: revision } : {}) },
      label: `Save ${key}`,
      queueWhenOffline: true,
      dedupeKey: `client-state:${scope}:${key}`,
      entityType: "client_state",
      entityId: `${scope}:${key}`,
      resourceKind: "clientState",
      resourceId: `${scope}:${key}`,
      baseRevision: revision ?? null,
      localSnapshot: { payload },
      changedFields: ["payload"],
      invalidate: [`/api/client-state/${scope}`],
    });
    if (!mayApplyClientState(scope, expectedOwner, getOfflineScopeIdentity())) return null;
    if (result.queued) {
      onQueued?.();
      return null;
    }
    return result.result?.record ?? null;
  };

  try {
    return await write(expectedRevision);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    if (!mayApplyClientState(scope, expectedOwner, getOfflineScopeIdentity())) return null;
    const latest = await queryApi<StateResponse<T>>(statePath(scope, key), {
      force: true,
      staleMs: 0,
      tags: ["client-state", `${scope}:${key}`],
    });
    return mayApplyClientState(scope, expectedOwner, getOfflineScopeIdentity()) ? write(latest.record?.revision ?? 0) : null;
  }
}

function sameClientStateValue(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

export function useServerState<T>(scope: ServerStateScope, key: string, fallback: T, options: UseServerStateOptions<T> = {}) {
  const initial = useRef(options.merge ? options.merge(fallback, fallback) : fallback);
  const stateOwner = getOfflineScopeIdentity();
  const stateOwnerKey = `${stateOwner.scope}:${stateOwner.generation}`;
  const [hydratedOwner, setHydratedOwner] = useState(stateOwnerKey);
  const [value, setValue] = useState<T>(initial.current);
  const [revision, setRevision] = useState<number | null>(null);
  const revisionRef = useRef<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const valueRef = useRef(value);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(0);
  const localChangeVersionRef = useRef(0);
  // Writes requested before the first read lands are replayed on top of the
  // saved value. Writing them straight away replaced saved layouts and tab
  // lists with defaults on every load.
  const hydratedRef = useRef(false);
  const deferredWritesRef = useRef<Array<SetStateAction<T>>>([]);
  const persistRef = useRef<Dispatch<SetStateAction<T>>>(() => undefined);
  const effectiveValue = hydratedOwner !== stateOwnerKey ? initial.current : value;
  valueRef.current = effectiveValue;

  useEffect(() => {
    // Prevent stale results and revisions from crossing a login transition.
    localChangeVersionRef.current += 1;
    const hydrationVersion = localChangeVersionRef.current;
    revisionRef.current = null;
    hydratedRef.current = false;
    deferredWritesRef.current = [];
    setRevision(null);
    setValue(initial.current);
    setHydratedOwner(stateOwnerKey);
    setHydrated(false);
    setQueued(false);
    setWriteError(null);
    if (options.enabled === false || (scope === "user" && stateOwner.scope === "anonymous")) {
      hydratedRef.current = true;
      setHydrated(true);
      return;
    }
    let alive = true;
    let savedValue: T = initial.current;
    (scope === "user" ? batchUserStateRead<T>(key) : queryApi<StateResponse<T>>(statePath(scope, key), {
      force: true,
      staleMs: 10_000,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      tags: ["client-state", `${scope}:${key}`],
    }))
      .then(async (result) => {
        if (!alive || !mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
        // Editing while a slow initial read is pending must not be undone by
        // its eventual response. Reconciliation remains explicit via revisions.
        if (localChangeVersionRef.current !== hydrationVersion) return;
        if (result.record) {
          const next = options.merge ? options.merge(result.record.payload, fallback) : result.record.payload;
          savedValue = next;
          // Pending early writes replay on top of this; showing the saved
          // value first would flash it before the user's change returns.
          if (!deferredWritesRef.current.length) {
            valueRef.current = next;
            setValue(next);
          }
          revisionRef.current = result.record.revision;
          setRevision(result.record.revision);
        }
      })
      .catch(() => {
        if (alive && mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) setWriteError("Could not refresh saved preferences. Retry after reconnecting.");
      })
      .finally(() => {
        if (!alive || !mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
        hydratedRef.current = true;
        setHydrated(true);
        const deferred = deferredWritesRef.current;
        deferredWritesRef.current = [];
        if (!deferred.length) return;
        // Replay against what is saved, not the optimistic pre-read value.
        if (localChangeVersionRef.current === hydrationVersion) valueRef.current = savedValue;
        for (const next of deferred) persistRef.current(next);
      });
    return () => { alive = false; };
  }, [scope, key, options.enabled, stateOwnerKey]);

  const setLocal = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
    localChangeVersionRef.current += 1;
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
  }, [scope, stateOwnerKey]);

  const persist = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    if (!hydratedRef.current && options.enabled !== false) {
      deferredWritesRef.current.push(next);
      valueRef.current = resolved;
      setValue(resolved);
      return;
    }
    // Re-rendering an unchanged tab list or layout must not generate an
    // identical PUT; recomputed arrays and objects compare by content.
    if (sameClientStateValue(resolved, valueRef.current)) return;
    localChangeVersionRef.current += 1;
    valueRef.current = resolved;
    setValue(resolved);
    if (options.enabled === false) return;
    pendingWritesRef.current += 1;
    setSaving(true);
    setWriteError(null);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (options.enabled === false || !mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
        const record = await writeServerState(scope, key, resolved, revisionRef.current, stateOwner, () => {
          if (mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) setQueued(true);
        });
        if (!record || !mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
        setQueued(false);
        revisionRef.current = record.revision;
        setRevision(record.revision);
      })
      .catch(() => {
        // The optimistic value stays local; do not report a server commit.
        // Handle the rejection here rather than leaving an unobserved promise.
        if (mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) setWriteError("Could not save preferences. Retry after reconnecting or review conflicts.");
      })
      .finally(() => {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        if (mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) setSaving(pendingWritesRef.current > 0);
      });
  }, [scope, key, options.enabled, stateOwnerKey]);
  persistRef.current = persist;

  return [effectiveValue, persist, {
    hydrated: hydratedOwner === stateOwnerKey && hydrated,
    saving: hydratedOwner === stateOwnerKey && saving,
    queued: hydratedOwner === stateOwnerKey && queued,
    error: hydratedOwner === stateOwnerKey ? writeError : null,
    revision: hydratedOwner === stateOwnerKey ? revision : null,
    setLocal,
  }] as const;
}
