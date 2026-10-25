import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { DELIVERY_RECORD_KINDS, type DeliveryRecordKind } from "@cluster/shared";
import { formatApiError, mutateApi, queryApi } from "./api";
import { emitClusterCohesionEvent, subscribeClusterCohesionEvent } from "./cohesion-events";
import { normalizeProjectIds, recordProjectId, stableWorkflowRecord, workflowKey } from "./project-workflow-utils";

export const PROJECT_DELIVERY_KINDS = DELIVERY_RECORD_KINDS;
export type ProjectDeliveryKind = DeliveryRecordKind;

type DeliveryEntity = { id: string; projectId?: string | null; revision?: number; updatedAt?: string; createdAt?: string };
type ServerDeliveryResponse<T> = { projectId?: string; projectIds?: string[]; kind: ProjectDeliveryKind; records: T[] };

type ProjectDeliveryListState = {
  loading: boolean;
  error: string;
  pending: number;
  refresh: () => Promise<void>;
};

export const PROJECT_DELIVERY_EVENT = "cluster-project-delivery-updated";
export type ProjectDeliveryUpdate = { kind: ProjectDeliveryKind; projectId: string };

export function emitProjectDeliveryUpdate(detail: ProjectDeliveryUpdate) {
  emitClusterCohesionEvent<ProjectDeliveryUpdate>(PROJECT_DELIVERY_EVENT, detail);
}

export function subscribeProjectDeliveryUpdate(handler: (detail: ProjectDeliveryUpdate) => void) {
  return subscribeClusterCohesionEvent<ProjectDeliveryUpdate>(PROJECT_DELIVERY_EVENT, handler);
}

function comparable(record: DeliveryEntity) {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = record as any;
  return stableWorkflowRecord(rest);
}

export function useProjectDeliveryList<T extends DeliveryEntity>(
  kind: ProjectDeliveryKind,
  projectIdsInput: string | string[],
  initialRecords: T[] = [],
): readonly [T[], Dispatch<SetStateAction<T[]>>, ProjectDeliveryListState] {
  const projectIds = useMemo(() => normalizeProjectIds(projectIdsInput), [Array.isArray(projectIdsInput) ? projectIdsInput.join("|") : projectIdsInput]);
  const projectIdsKey = projectIds.join("|");
  const [items, setItemsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const recordsRef = useRef(new Map<string, T>());
  const chainsRef = useRef(new Map<string, Promise<void>>());
  const loadGenerationRef = useRef(0);
  const initialRecordsRef = useRef(initialRecords);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!projectIds.length) {
      recordsRef.current = new Map();
      setItemsState([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    try {
      const response = projectIds.length > 1
        ? await queryApi<ServerDeliveryResponse<T>>(`/api/project-delivery/${kind}?projectIds=${encodeURIComponent(projectIds.join(","))}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-delivery", kind, "projects"] })
        : await queryApi<ServerDeliveryResponse<T>>(`/api/projects/${encodeURIComponent(projectIds[0])}/delivery/${kind}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-delivery", kind, projectIds[0]] });
      if (generation !== loadGenerationRef.current) return;
      const rows = response.records || [];
      const nextMap = new Map<string, T>();
      for (const row of rows) {
        const projectId = recordProjectId(row, projectIds);
        if (projectId) nextMap.set(workflowKey(projectId, row.id), row);
      }
      recordsRef.current = nextMap;
      setItemsState(rows.length ? rows : initialRecordsRef.current);
      setError("");
    } catch (caught) {
      if (generation !== loadGenerationRef.current) return;
      setError(formatApiError(caught));
      if (!recordsRef.current.size) setItemsState(initialRecordsRef.current);
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [kind, projectIdsKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeProjectDeliveryUpdate((event) => {
    if (event.kind === kind && projectIds.includes(event.projectId)) void load();
  }), [kind, load, projectIdsKey]);

  const enqueue = useCallback((key: string, operation: () => Promise<void>) => {
    const previous = chainsRef.current.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation).finally(() => {
      if (chainsRef.current.get(key) === next) chainsRef.current.delete(key);
    });
    chainsRef.current.set(key, next);
  }, []);

  const syncDiff = useCallback((previous: T[], next: T[]) => {
    const previousByKey = new Map<string, T>();
    const nextByKey = new Map<string, T>();
    for (const row of previous) {
      const projectId = recordProjectId(row, projectIds);
      if (projectId) previousByKey.set(workflowKey(projectId, row.id), row);
    }
    for (const row of next) {
      const projectId = recordProjectId(row, projectIds);
      if (projectId) nextByKey.set(workflowKey(projectId, row.id), row);
    }

    for (const [key, row] of nextByKey) {
      const before = previousByKey.get(key);
      if (before && comparable(before) === comparable(row)) continue;
      const projectId = recordProjectId(row, projectIds);
      if (!projectId) continue;
      enqueue(key, async () => {
        setPending((count) => count + 1);
        try {
          const expectedRevision = recordsRef.current.get(key)?.revision || before?.revision;
          const payload = { ...(row as any) };
          delete payload.revision;
          delete payload.createdAt;
          delete payload.updatedAt;
          const mutation = await mutateApi<T>(`/api/projects/${encodeURIComponent(projectId)}/delivery/${kind}/${encodeURIComponent(row.id)}`, {
            method: "PUT",
            label: `Save ${kind}`,
            dedupeKey: `project-delivery-put:${kind}:${key}`,
            entityType: `project_${kind}`,
            entityId: row.id,
            resourceKind: kind,
            resourceId: row.id,
            baseRevision: expectedRevision || null,
            body: { payload, ...(expectedRevision ? { expectedRevision } : {}) },
            invalidate: [`/api/projects/${projectId}/delivery/${kind}`, `/api/project-delivery/${kind}`],
          });
          const result = mutation.result || row;
          recordsRef.current.set(key, result);
          setItemsState((current) => current.map((item) => item.id === row.id && recordProjectId(item, projectIds) === projectId ? result : item));
          setError("");
          emitProjectDeliveryUpdate({ kind, projectId });
        } catch (caught) {
          setError(formatApiError(caught));
          void load();
        } finally {
          setPending((count) => Math.max(0, count - 1));
        }
      });
    }

    for (const [key, row] of previousByKey) {
      if (nextByKey.has(key)) continue;
      const projectId = recordProjectId(row, projectIds);
      if (!projectId) continue;
      enqueue(key, async () => {
        setPending((count) => count + 1);
        try {
          const expectedRevision = recordsRef.current.get(key)?.revision || row.revision;
          await mutateApi(`/api/projects/${encodeURIComponent(projectId)}/delivery/${kind}/${encodeURIComponent(row.id)}${expectedRevision ? `?expectedRevision=${expectedRevision}` : ""}`, {
            method: "DELETE",
            label: `Remove ${kind}`,
            dedupeKey: `project-delivery-delete:${kind}:${key}`,
            entityType: `project_${kind}`,
            entityId: row.id,
            resourceKind: kind,
            resourceId: row.id,
            baseRevision: expectedRevision || null,
            invalidate: [`/api/projects/${projectId}/delivery/${kind}`, `/api/project-delivery/${kind}`],
          });
          recordsRef.current.delete(key);
          setError("");
          emitProjectDeliveryUpdate({ kind, projectId });
        } catch (caught) {
          setError(formatApiError(caught));
          void load();
        } finally {
          setPending((count) => Math.max(0, count - 1));
        }
      });
    }
  }, [enqueue, kind, load, projectIdsKey]);

  const setItems: Dispatch<SetStateAction<T[]>> = useCallback((action) => {
    setItemsState((previous) => {
      const next = typeof action === "function" ? (action as (rows: T[]) => T[])(previous) : action;
      queueMicrotask(() => syncDiff(previous, next));
      return next;
    });
  }, [syncDiff]);

  return [items, setItems, { loading, error, pending, refresh: load }] as const;
}
