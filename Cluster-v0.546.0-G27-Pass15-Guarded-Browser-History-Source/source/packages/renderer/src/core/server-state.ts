import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, mutateApi, queryApi } from "./api";
import { getOfflineScope } from "./offline-storage";

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
  if (scope === "user" && getOfflineScope() === "anonymous") return fallback;
  const result = await queryApi<StateResponse<T>>(statePath(scope, key), {
    force,
    staleMs: 10_000,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    tags: ["client-state", `${scope}:${key}`],
  });
  return result.record?.payload ?? fallback;
}

export async function writeServerState<T>(scope: ServerStateScope, key: string, payload: T, expectedRevision?: number | null) {
  if (scope === "user" && getOfflineScope() === "anonymous") return null;
  const write = async (revision: number | null | undefined) => {
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
    return result.result?.record ?? null;
  };

  try {
    return await write(expectedRevision);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const latest = await queryApi<StateResponse<T>>(statePath(scope, key), {
      force: true,
      staleMs: 0,
      tags: ["client-state", `${scope}:${key}`],
    });
    return write(latest.record?.revision ?? 0);
  }
}

export function useServerState<T>(scope: ServerStateScope, key: string, fallback: T, options: UseServerStateOptions<T> = {}) {
  const initial = useRef(options.merge ? options.merge(fallback, fallback) : fallback);
  const [value, setValue] = useState<T>(initial.current);
  const [revision, setRevision] = useState<number | null>(null);
  const revisionRef = useRef<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const valueRef = useRef(value);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(0);
  valueRef.current = value;

  useEffect(() => {
    if (options.enabled === false || (scope === "user" && getOfflineScope() === "anonymous")) {
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
        if (!alive) return;
        if (result.record) {
          const next = options.merge ? options.merge(result.record.payload, fallback) : result.record.payload;
          setValue(next);
          revisionRef.current = result.record.revision;
          setRevision(result.record.revision);
        }
      })
      .finally(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, [scope, key, options.enabled]);

  const setLocal = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
  }, []);

  const persist = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
    if (options.enabled === false) return;
    pendingWritesRef.current += 1;
    setSaving(true);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (options.enabled === false || (scope === "user" && getOfflineScope() === "anonymous")) return;
        const record = await writeServerState(scope, key, resolved, revisionRef.current);
        if (!record) return;
        revisionRef.current = record.revision;
        setRevision(record.revision);
      })
      .finally(() => {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        setSaving(pendingWritesRef.current > 0);
      });
  }, [scope, key, options.enabled]);

  return [value, persist, { hydrated, saving, revision, setLocal }] as const;
}
