import type { SharedWorkActivity, SharedWorkReference, SharedWorkWatchReference, SharedWorkWatchScope } from "@cluster/shared";
import { api } from "../../core/api/transport";

const q = (value: string) => encodeURIComponent(value);

export type SharedWorkWatchState = {
  watching: boolean;
  scopes: SharedWorkWatchScope[];
};

export async function loadSharedWorkWatch(entity: SharedWorkWatchReference) {
  return api<SharedWorkWatchState>(`/api/shared-work/watch?entityType=${q(entity.kind)}&entityId=${q(entity.id)}`);
}

export async function setSharedWorkWatch(entity: SharedWorkWatchReference, scopes: readonly SharedWorkWatchScope[]) {
  return api<SharedWorkWatchState>("/api/shared-work/watch", {
    method: "PUT",
    body: JSON.stringify({ entity, scopes: [...scopes] }),
  });
}

export async function unwatchSharedWork(entity: SharedWorkWatchReference) {
  return api<{ ok: boolean }>(`/api/shared-work/watch?entityType=${q(entity.kind)}&entityId=${q(entity.id)}`, {
    method: "DELETE",
  });
}


export type SharedWorkActivityRecord = SharedWorkActivity & {
  user?: { id: string; username?: string | null; displayName?: string | null; avatarUrl?: string | null } | null;
};

export async function loadSharedWorkActivity(entity: SharedWorkReference, options: { entityType?: string; limit?: number } = {}) {
  const params = new URLSearchParams({
    entityType: options.entityType || entity.kind,
    entityId: entity.id,
    limit: String(Math.max(1, Math.min(50, options.limit || 12))),
  });
  if (entity.projectId) params.set("projectId", entity.projectId);
  const rows = await api<Array<Omit<SharedWorkActivityRecord, "entity" | "actorId"> & { userId?: string | null }>>(`/api/activity?${params.toString()}`);
  return rows.map((row) => ({
    ...row,
    entity,
    actorId: row.userId || row.user?.id || null,
  })) satisfies SharedWorkActivityRecord[];
}
