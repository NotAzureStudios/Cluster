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
  const effectiveValue = hydratedOwner !== stateOwnerKey ? initial.current : value;
  valueRef.current = effectiveValue;

  useEffect(() => {
    // Prevent stale results and revisions from crossing a login transition.
    localChangeVersionRef.current += 1;
    const hydrationVersion = localChangeVersionRef.current;
    revisionRef.current = null;
    setRevision(null);
    setValue(initial.current);
    setHydratedOwner(stateOwnerKey);
    setHydrated(false);
    setQueued(false);
    setWriteError(null);
    if (options.enabled === false || (scope === "user" && stateOwner.scope === "anonymous")) {
      setHydrated(true);
      return;
    }
    let alive = true;
    queryApi<StateResponse<T>>(statePath(scope, key), {
      force: true,
      staleMs: 10_000,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      tags: ["client-state", `${scope}:${key}`],
    })
      .then(async (result) => {
        if (!alive || !mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) return;
        // Editing while a slow initial read is pending must not be undone by
        // its eventual response. Reconciliation remains explicit via revisions.
        if (localChangeVersionRef.current !== hydrationVersion) return;
        if (result.record) {
          const next = options.merge ? options.merge(result.record.payload, fallback) : result.record.payload;
          setValue(next);
          revisionRef.current = result.record.revision;
          setRevision(result.record.revision);
        }
      })
      .catch(() => {
        if (alive && mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) setWriteError("Could not refresh saved preferences. Retry after reconnecting.");
      })
      .finally(() => { if (alive && mayApplyClientState(scope, stateOwner, getOfflineScopeIdentity())) setHydrated(true); });
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
    localChangeVersionRef.current += 1;
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
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

  return [effectiveValue, persist, {
    hydrated: hydratedOwner === stateOwnerKey && hydrated,
    saving: hydratedOwner === stateOwnerKey && saving,
    queued: hydratedOwner === stateOwnerKey && queued,
    error: hydratedOwner === stateOwnerKey ? writeError : null,
    revision: hydratedOwner === stateOwnerKey ? revision : null,
    setLocal,
  }] as const;
}
