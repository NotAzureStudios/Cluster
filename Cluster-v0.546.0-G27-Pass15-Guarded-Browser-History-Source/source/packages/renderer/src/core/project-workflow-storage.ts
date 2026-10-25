import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { formatApiError, mutateApi, queryApi } from "./api";
import { emitClusterCohesionEvent, subscribeClusterCohesionEvent } from "./cohesion-events";
import { listOfflineMutations, subscribeOfflineStorage } from "./offline-storage";
import { normalizeProjectIds, recordProjectId, stableWorkflowRecord, workflowKey } from "./project-workflow-utils";

export const PROJECT_WORKFLOW_KINDS = [
  "dependency",
  "recurring",
  "watcher",
  "meeting",
  "versionSnapshot",
  "boardView",
  "whiteboardComponent",
] as const;

export type ProjectWorkflowKind = (typeof PROJECT_WORKFLOW_KINDS)[number];

type WorkflowEntity = { id: string; projectId?: string | null; updatedAt?: string; createdAt?: string };
type ServerWorkflowRecord<T> = {
  id: string;
  kind: ProjectWorkflowKind;
  projectId: string;
  entityId: string;
  revision: number;
  validationState: string;
  validationSummary?: string | null;
  syncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  payload: T;
};
type ServerWorkflowResponse<T> = { projectId?: string; projectIds?: string[]; kind: ProjectWorkflowKind; records: Array<ServerWorkflowRecord<T>> };

type ProjectWorkflowListState = {
  loading: boolean;
  error: string;
  pending: number;
  queued: number;
  refresh: () => Promise<void>;
};

export const PROJECT_WORKFLOW_EVENT = "cluster-project-workflow-updated";
export type ProjectWorkflowUpdate = { kind: string; projectId: string };

export function emitProjectWorkflowUpdate(detail: ProjectWorkflowUpdate) {
  emitClusterCohesionEvent<ProjectWorkflowUpdate>(PROJECT_WORKFLOW_EVENT, detail);
}

export function subscribeProjectWorkflowUpdate(handler: (detail: ProjectWorkflowUpdate) => void) {
  return subscribeClusterCohesionEvent<ProjectWorkflowUpdate>(PROJECT_WORKFLOW_EVENT, handler);
}

function dispatchWorkflowUpdate(kind: ProjectWorkflowKind, projectId: string) {
  emitProjectWorkflowUpdate({ kind, projectId });
}

export function useProjectWorkflowList<T extends WorkflowEntity>(
  kind: ProjectWorkflowKind,
  projectIdsInput: string | string[],
): readonly [T[], Dispatch<SetStateAction<T[]>>, ProjectWorkflowListState] {
  const projectIds = useMemo(() => normalizeProjectIds(projectIdsInput), [Array.isArray(projectIdsInput) ? projectIdsInput.join("|") : projectIdsInput]);
  const projectIdsKey = projectIds.join("|");
  const [items, setItemsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [queued, setQueued] = useState(0);
  const recordsRef = useRef(new Map<string, ServerWorkflowRecord<T>>());
  const chainsRef = useRef(new Map<string, Promise<void>>());
  const loadGenerationRef = useRef(0);

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
      const responses = projectIds.length > 1
        ? [await queryApi<ServerWorkflowResponse<T>>(`/api/project-workflows/${kind}?projectIds=${encodeURIComponent(projectIds.join(","))}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-workflow", kind, "projects"] })]
        : await Promise.all(projectIds.map((projectId) => queryApi<ServerWorkflowResponse<T>>(`/api/projects/${encodeURIComponent(projectId)}/workflows/${kind}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-workflow", kind, "projects"] })));
      if (generation !== loadGenerationRef.current) return;
      const serverRecords = responses.flatMap((response) => response.records || []);
      if (generation !== loadGenerationRef.current) return;
      const recordMap = new Map<string, ServerWorkflowRecord<T>>();
      serverRecords.forEach((record) => recordMap.set(workflowKey(record.projectId, record.entityId), record));
      recordsRef.current = recordMap;
      const next = Array.from(recordMap.values())
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((record) => ({ ...record.payload, id: record.entityId, projectId: record.projectId } as T));
      setItemsState(next);
      setError("");
    } catch (caught) {
      if (generation !== loadGenerationRef.current) return;
      setError(formatApiError(caught));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [kind, projectIdsKey]);

  useEffect(() => { void load(); }, [load]);

  const refreshQueued = useCallback(async () => {
    const projectPathPrefixes = projectIds.map((projectId) => `/api/projects/${encodeURIComponent(projectId)}/workflows/${kind}/`);
    const queuedMutations = await listOfflineMutations();
    setQueued(queuedMutations.filter((mutation) => mutation.resourceKind === kind && projectPathPrefixes.some((prefix) => mutation.path.startsWith(prefix))).length);
  }, [kind, projectIdsKey]);

  useEffect(() => {
    void refreshQueued();
    return subscribeOfflineStorage((area) => {
      if (area === "mutations" || area === "scope" || area === "all") void refreshQueued();
    });
  }, [refreshQueued]);

  useEffect(() => subscribeProjectWorkflowUpdate((detail) => {
    if (detail.kind !== kind || !projectIds.includes(detail.projectId)) return;
    void load();
  }), [kind, projectIdsKey, load]);

  const enqueue = useCallback((key: string, task: () => Promise<void>) => {
    const previous = chainsRef.current.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(task).finally(() => {
      if (chainsRef.current.get(key) === next) chainsRef.current.delete(key);
    });
    chainsRef.current.set(key, next);
  }, []);

  const syncDiff = useCallback((previous: T[], next: T[]) => {
    const previousByKey = new Map(previous.map((record) => {
      const projectId = recordProjectId(record, projectIds);
      return [workflowKey(projectId, record.id), { record, projectId }] as const;
    }));
    const nextByKey = new Map(next.map((record) => {
      const projectId = recordProjectId(record, projectIds);
      return [workflowKey(projectId, record.id), { record: { ...record, projectId } as T, projectId }] as const;
    }));

    for (const [key, entry] of nextByKey.entries()) {
      if (!entry.projectId) {
        setError(`A ${kind} record is missing its project.`);
        continue;
      }
      const before = previousByKey.get(key)?.record;
      if (before && stableWorkflowRecord(before) === stableWorkflowRecord(entry.record)) continue;
      enqueue(key, async () => {
        setPending((count) => count + 1);
        try {
          const current = recordsRef.current.get(key);
          const path = `/api/projects/${encodeURIComponent(entry.projectId)}/workflows/${kind}/${encodeURIComponent(entry.record.id)}`;
          const result = await mutateApi<ServerWorkflowRecord<T>>(path, {
            method: "PUT",
            body: { payload: entry.record },
            label: `Save ${kind}`,
            dedupeKey: `project-workflow:${kind}:${key}`,
            entityType: `project_${kind}`,
            entityId: entry.record.id,
            resourceKind: kind,
            resourceId: entry.record.id,
            baseRevision: current?.revision || null,
            optimisticResult: current ? { ...current, payload: entry.record, revision: current.revision + 1 } : undefined,
            invalidate: [`/api/projects/${entry.projectId}/workflows/${kind}`],
            baseSnapshot: before as unknown as Record<string, unknown> | undefined,
            localSnapshot: entry.record as unknown as Record<string, unknown>,
          });
          if (result.queued) {
            await refreshQueued();
            return;
          }
          if (result.result) {
            const serverKey = workflowKey(result.result.projectId, result.result.entityId);
            recordsRef.current.delete(key);
            recordsRef.current.set(serverKey, result.result);
            if (result.result.entityId !== entry.record.id) {
              setError("");
              await load();
              dispatchWorkflowUpdate(kind, entry.projectId);
              return;
            }
          }
          setError("");
          dispatchWorkflowUpdate(kind, entry.projectId);
        } catch (caught) {
          setError(formatApiError(caught));
          void load();
        } finally {
          setPending((count) => Math.max(0, count - 1));
        }
      });
    }

    for (const [key, entry] of previousByKey.entries()) {
      if (nextByKey.has(key) || !entry.projectId) continue;
      enqueue(key, async () => {
        setPending((count) => count + 1);
        try {
          const current = recordsRef.current.get(key);
          const revisionQuery = current?.revision ? `?expectedRevision=${current.revision}` : "";
          const result = await mutateApi<{ ok: boolean }>(`/api/projects/${encodeURIComponent(entry.projectId)}/workflows/${kind}/${encodeURIComponent(entry.record.id)}${revisionQuery}`, {
            method: "DELETE",
            label: `Remove ${kind}`,
            dedupeKey: `project-workflow-delete:${kind}:${key}`,
            entityType: `project_${kind}`,
            entityId: entry.record.id,
            resourceKind: kind,
            resourceId: entry.record.id,
            baseRevision: current?.revision || null,
            optimisticResult: { ok: true },
            invalidate: [`/api/projects/${entry.projectId}/workflows/${kind}`],
            baseSnapshot: entry.record as unknown as Record<string, unknown>,
          });
          if (result.queued) {
            await refreshQueued();
            return;
          }
          recordsRef.current.delete(key);
          setError("");
          dispatchWorkflowUpdate(kind, entry.projectId);
        } catch (caught) {
          setError(formatApiError(caught));
          void load();
        } finally {
          setPending((count) => Math.max(0, count - 1));
        }
      });
    }
  }, [enqueue, kind, load, projectIdsKey, refreshQueued]);

  const setItems: Dispatch<SetStateAction<T[]>> = useCallback((action) => {
    setItemsState((previous) => {
      const next = typeof action === "function" ? (action as (rows: T[]) => T[])(previous) : action;
      queueMicrotask(() => syncDiff(previous, next));
      return next;
    });
  }, [syncDiff]);

  return [items, setItems, { loading, error, pending, queued, refresh: load }] as const;
}
