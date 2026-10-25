import { flushApiOutbox, mutateApi } from "../../core/api";
import {
  listOfflineMutations,
  queueOfflineMutation,
  rebaseOfflineMutation,
  removeOfflineMutation,
  subscribeOfflineStorage,
  type OfflineMutationRecord,
} from "../../core/offline-storage";

export type CollaborationMutation = {
  id: string;
  tool: "board" | "whiteboard";
  resourceId: string;
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  label: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  status: "pending" | "paused" | "replaying" | "conflict" | "failed";
  lastError?: string | null;
  conflictPayload?: unknown;
};

const CHANGE_EVENT = "cluster-collaboration-offline-queue-changed";
let snapshot: CollaborationMutation[] = [];
let hydratePromise: Promise<void> | null = null;
let initialized = false;

function mapMutation(item: OfflineMutationRecord): CollaborationMutation | null {
  if (!(["board", "whiteboard"] as string[]).includes(String(item.resourceKind || "")) || !item.resourceId) return null;
  return {
    id: item.id,
    tool: item.resourceKind as "board" | "whiteboard",
    resourceId: item.resourceId,
    path: item.path,
    method: item.method,
    body: item.body,
    label: item.label,
    entityType: item.entityType,
    entityId: item.entityId,
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
    attempts: item.attempts,
    status: item.status,
    lastError: item.lastError,
    conflictPayload: item.conflictPayload,
  };
}

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

async function hydrate() {
  if (hydratePromise) return hydratePromise;
  hydratePromise = listOfflineMutations()
    .then((items) => {
      snapshot = items.map(mapMutation).filter((item): item is CollaborationMutation => Boolean(item));
      emit();
    })
    .finally(() => {
      hydratePromise = null;
    });
  return hydratePromise;
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  subscribeOfflineStorage(() => void hydrate());
  void hydrate();
}

initialize();

export function collaborationMutationQueue(tool?: "board" | "whiteboard", resourceId?: string | null) {
  return snapshot.filter((item) => (!tool || item.tool === tool) && (!resourceId || item.resourceId === resourceId));
}

export function subscribeCollaborationMutationQueue(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  const unsubscribe = subscribeOfflineStorage(() => void hydrate());
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    unsubscribe();
  };
}

export function queueCollaborationMutation(input: Omit<CollaborationMutation, "id" | "createdAt" | "updatedAt" | "attempts" | "status">) {
  const now = Date.now();
  const id = `collab-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const expectedRevision = Number(input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>).expectedRevision : 0) || null;
  const dedupeKey = input.entityType && input.entityId
    ? `${input.tool}:${input.resourceId}:${input.entityType}:${input.entityId}:${input.method}`
    : null;
  const optimistic: CollaborationMutation = {
    ...input,
    id,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    attempts: 0,
    status: "pending",
  };
  if (dedupeKey && ["PATCH", "PUT"].includes(input.method)) {
    snapshot = snapshot.filter((item) => !(item.status === "pending" && item.tool === input.tool && item.resourceId === input.resourceId && item.entityType === input.entityType && item.entityId === input.entityId && item.method === input.method));
  }
  snapshot.push(optimistic);
  emit();
  void queueOfflineMutation({
    id,
    idempotencyKey: id,
    path: input.path,
    method: input.method,
    headers: {},
    body: input.body,
    label: input.label,
    dedupeKey,
    entityType: input.entityType,
    entityId: input.entityId,
    resourceKind: input.tool,
    resourceId: input.resourceId,
    baseRevision: expectedRevision,
    localSnapshot: input.body && typeof input.body === "object" && !Array.isArray(input.body) ? input.body as Record<string, unknown> : null,
    changedFields: input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? Object.keys(input.body as Record<string, unknown>).filter((key) => key !== "expectedRevision")
      : [],
    invalidatePaths: input.tool === "board" ? ["/api/projects", `/api/boards/${input.resourceId}`] : ["/api/projects", `/api/whiteboards/${input.resourceId}`],
  }).then(() => hydrate());
  return optimistic;
}

export function discardCollaborationMutation(id: string) {
  snapshot = snapshot.filter((item) => item.id !== id);
  emit();
  void removeOfflineMutation(id).then(() => hydrate());
}

export function retryCollaborationMutation(id: string) {
  snapshot = snapshot.map((item) => item.id === id ? { ...item, status: "pending", lastError: null, conflictPayload: undefined, updatedAt: new Date().toISOString() } : item);
  emit();
  void rebaseOfflineMutation(id).then(() => hydrate());
}

export async function sendOrQueueCollaborationMutation<T>(input: Omit<CollaborationMutation, "id" | "createdAt" | "updatedAt" | "attempts" | "status">): Promise<{ queued: boolean; result?: T; mutation?: CollaborationMutation }> {
  const expectedRevision = Number(input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>).expectedRevision : 0) || null;
  const result = await mutateApi<T>(input.path, {
    method: input.method,
    body: input.body,
    label: input.label,
    dedupeKey: input.entityType && input.entityId ? `${input.tool}:${input.resourceId}:${input.entityType}:${input.entityId}:${input.method}` : null,
    entityType: input.entityType,
    entityId: input.entityId,
    resourceKind: input.tool,
    resourceId: input.resourceId,
    baseRevision: expectedRevision,
    localSnapshot: input.body && typeof input.body === "object" && !Array.isArray(input.body) ? input.body as Record<string, unknown> : null,
    changedFields: input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? Object.keys(input.body as Record<string, unknown>).filter((key) => key !== "expectedRevision")
      : [],
    invalidate: input.tool === "board" ? ["/api/projects", `/api/boards/${input.resourceId}`] : ["/api/projects", `/api/whiteboards/${input.resourceId}`],
  });
  await hydrate();
  return {
    queued: result.queued,
    result: result.result,
    mutation: result.mutation ? mapMutation(result.mutation) || undefined : undefined,
  };
}

export async function flushCollaborationMutationQueue(tool?: "board" | "whiteboard", resourceId?: string | null) {
  await flushApiOutbox();
  await hydrate();
  return collaborationMutationQueue(tool, resourceId);
}
