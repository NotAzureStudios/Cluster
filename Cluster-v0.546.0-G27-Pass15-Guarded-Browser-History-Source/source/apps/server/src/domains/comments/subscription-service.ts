import {
  SHARED_WORK_WATCH_ENTITY_KINDS,
  SHARED_WORK_WATCH_SCOPES,
  normalizeSharedWorkWatchScopes,
  type ClusterResourceAddress,
  type SharedWorkWatchEntityKind,
  type SharedWorkWatchReference,
  type SharedWorkWatchScope,
} from "@cluster/shared";

function parsePayload(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function watchKindForResource(kind: string): SharedWorkWatchEntityKind | null {
  const normalized = kind === "project_control" ? "control" : String(kind || "").trim().toLowerCase();
  return (SHARED_WORK_WATCH_ENTITY_KINDS as readonly string[]).includes(normalized)
    ? normalized as SharedWorkWatchEntityKind
    : null;
}

function storedScope(row: any): SharedWorkWatchScope | null {
  const candidate = String(parsePayload(row.payload).scope || row.sourceKey || "").trim();
  return (SHARED_WORK_WATCH_SCOPES as readonly string[]).includes(candidate)
    ? candidate as SharedWorkWatchScope
    : null;
}

function serialize(row: any) {
  return {
    id: row.id,
    ...parsePayload(row.payload),
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
  };
}

export function notificationWatchScope(input: { signal?: string | null; entityType?: string | null }): SharedWorkWatchScope {
  const signal = String(input.signal || "").trim().toLowerCase();
  const entityType = String(input.entityType || "").trim().toLowerCase();
  if (["comment", "mention"].includes(signal) || /comment|reply|annotation/.test(entityType)) return "comments";
  if (["approval", "review"].includes(signal) || /approval|review/.test(entityType)) return "approvals";
  if (["version", "release"].includes(signal) || /file|asset|attachment|version/.test(entityType)) return "files";
  return "status";
}

export type SubscriptionRecipientAuthorizer = (input: {
  userId: string;
  resource: ClusterResourceAddress;
  scope: SharedWorkWatchScope;
}) => Promise<boolean>;

export function createSubscriptionService(prisma: any, input: { authorizeRecipient?: SubscriptionRecipientAuthorizer | null } = {}) {
  let authorizeRecipient: SubscriptionRecipientAuthorizer | null = input.authorizeRecipient || null;
  async function rowsFor(resource: ClusterResourceAddress, userId?: string | null) {
    const entityType = watchKindForResource(resource.kind);
    if (!entityType) return [];
    return prisma.clusterPersistenceRecord.findMany({
      where: {
        kind: "sharedWorkWatcher",
        entityType,
        entityId: resource.id,
        archived: false,
        ...(userId ? { userId: String(userId) } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: userId ? SHARED_WORK_WATCH_SCOPES.length : 5_000,
    });
  }

  return {
    setRecipientAuthorizer(authorizer: SubscriptionRecipientAuthorizer | null) { authorizeRecipient = authorizer; },

    async get(resource: ClusterResourceAddress, userId: string) {
      const rows = await rowsFor(resource, userId);
      const scopes = normalizeSharedWorkWatchScopes(rows.map(storedScope).filter((scope: SharedWorkWatchScope | null): scope is SharedWorkWatchScope => Boolean(scope)));
      return { watching: scopes.length > 0, scopes, records: rows.map(serialize) };
    },

    async set(input: { entity: SharedWorkWatchReference; userId: string; scopes: SharedWorkWatchScope[]; muted?: boolean }) {
      const scopes = normalizeSharedWorkWatchScopes(input.scopes);
      const userId = String(input.userId);
      const entityType = watchKindForResource(input.entity.kind);
      if (!entityType) throw new Error(`Resource kind ${input.entity.kind} does not support subscriptions.`);
      const resource: ClusterResourceAddress = { kind: entityType === "control" ? "project_control" : entityType as any, id: input.entity.id, ...(input.entity.projectId ? { projectId: input.entity.projectId } : {}) };
      const baseWhere = { kind: "sharedWorkWatcher", entityType, entityId: input.entity.id, userId, archived: false };
      const title = String(input.entity.label || input.entity.kind.replaceAll("_", " ")).trim().slice(0, 200);
      const now = new Date();
      const rows = await prisma.$transaction(async (tx: any) => {
        if (!scopes.length) {
          await tx.clusterPersistenceRecord.updateMany({ where: baseWhere, data: { archived: true, status: "removed", revision: { increment: 1 }, syncedAt: now } });
          return [];
        }
        await tx.clusterPersistenceRecord.updateMany({
          where: { ...baseWhere, sourceKey: { notIn: scopes } },
          data: { archived: true, status: "removed", revision: { increment: 1 }, syncedAt: now },
        });
        for (const scope of scopes) {
          const id = `shared-watch:${userId}:${entityType}:${input.entity.id}:${scope}`;
          const payload = { entity: input.entity, userId, scope, muted: Boolean(input.muted) };
          await tx.clusterPersistenceRecord.upsert({
            where: { id },
            create: {
              id, kind: "sharedWorkWatcher", title: `Watch ${title}`, projectId: input.entity.projectId || null,
              entityType, entityId: input.entity.id, userId, ownerId: userId, status: input.muted ? "muted" : "active",
              visibility: "internal", sourceKey: scope, payload: JSON.stringify(payload), syncedAt: now, revision: 1,
            },
            update: {
              archived: false, status: input.muted ? "muted" : "active", projectId: input.entity.projectId || null,
              title: `Watch ${title}`, payload: JSON.stringify(payload), syncedAt: now, revision: { increment: 1 },
            },
          });
        }
        return tx.clusterPersistenceRecord.findMany({ where: baseWhere, orderBy: { updatedAt: "desc" }, take: SHARED_WORK_WATCH_SCOPES.length });
      });
      return { resource, watching: scopes.length > 0, scopes, records: rows.map(serialize) };
    },

    async remove(resource: ClusterResourceAddress, userId: string, scope?: SharedWorkWatchScope | null) {
      const entityType = watchKindForResource(resource.kind);
      if (!entityType) return { count: 0 };
      return prisma.clusterPersistenceRecord.updateMany({
        where: { kind: "sharedWorkWatcher", entityType, entityId: resource.id, userId: String(userId), archived: false, ...(scope ? { sourceKey: scope } : {}) },
        data: { archived: true, status: "removed", revision: { increment: 1 }, syncedAt: new Date() },
      });
    },

    async recipientIds(resource: ClusterResourceAddress, scope: SharedWorkWatchScope, options: { excludeUserIds?: string[] } = {}) {
      const rows = await rowsFor(resource);
      const excluded = new Set((options.excludeUserIds || []).map(String));
      const ids = new Set<string>();
      for (const row of rows) {
        const payload = parsePayload(row.payload);
        const stored = storedScope(row);
        if (!stored || payload.muted === true || row.status === "muted") continue;
        if (stored !== "all" && stored !== scope) continue;
        const userId = String(row.userId || payload.userId || "").trim();
        if (userId && !excluded.has(userId)) ids.add(userId);
      }
      const candidates = [...ids];
      if (!authorizeRecipient || !candidates.length) return candidates;
      const decisions = await Promise.all(candidates.map(async (userId) => {
        try {
          return await authorizeRecipient!({ userId, resource, scope }) ? userId : null;
        } catch {
          return null;
        }
      }));
      return decisions.filter((userId): userId is string => Boolean(userId));
    },
  };
}
