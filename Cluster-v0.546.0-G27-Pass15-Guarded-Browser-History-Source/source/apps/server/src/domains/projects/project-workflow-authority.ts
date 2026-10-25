import {
  CLUSTER_WORKFLOW_RELATIONSHIPS,
  SHARED_WORK_WATCH_ENTITY_KINDS,
  SHARED_WORK_WATCH_SCOPES,
  type ClusterWorkflowRelationship,
  type SharedWorkWatchEntityKind,
  type SharedWorkWatchScope,
} from "@cluster/shared";
import { createHttpError } from "../../core/http-errors.js";
import { createSubscriptionService } from "../comments/subscription-service.js";

export const CANONICAL_PROJECT_WORKFLOW_KINDS = ["dependency", "recurring", "watcher"] as const;
export type CanonicalProjectWorkflowKind = (typeof CANONICAL_PROJECT_WORKFLOW_KINDS)[number];

export function isCanonicalProjectWorkflowKind(kind: string): kind is CanonicalProjectWorkflowKind {
  return (CANONICAL_PROJECT_WORKFLOW_KINDS as readonly string[]).includes(kind);
}

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function wrapper(kind: CanonicalProjectWorkflowKind, projectId: string, entityId: string, payload: Record<string, any>, source: any) {
  return {
    id: String(source.id || entityId),
    kind,
    projectId,
    entityId,
    revision: Number(source.revision || 1),
    validationState: "canonical",
    validationSummary: `Backed by ${kind === "dependency" ? "ProjectRelationship" : kind === "recurring" ? "Project Automation" : "Subscription"}.`,
    syncedAt: iso(source.updatedAt || source.createdAt),
    createdAt: iso(source.createdAt) || new Date().toISOString(),
    updatedAt: iso(source.updatedAt || source.createdAt) || new Date().toISOString(),
    payload,
  };
}

function normalizeRelationship(value: unknown): ClusterWorkflowRelationship {
  const raw = String(value || "relates_to").trim().toLowerCase().replaceAll(" ", "_");
  const aliases: Record<string, ClusterWorkflowRelationship> = {
    depends: "depends_on",
    dependency: "depends_on",
    gates: "blocks",
    blocked: "blocked_by",
    related: "relates_to",
    relates: "relates_to",
    duplicate: "duplicates",
  };
  const normalized = aliases[raw] || raw;
  if (!(CLUSTER_WORKFLOW_RELATIONSHIPS as readonly string[]).includes(normalized)) {
    throw createHttpError("VALIDATION_FAILED", `Unsupported project relationship: ${raw}.`, 400);
  }
  return normalized as ClusterWorkflowRelationship;
}

function recurrenceFromCadence(cadence: unknown) {
  const value = String(cadence || "weekly").toLowerCase();
  if (value === "daily") return { every: 1, unit: "day" };
  if (value === "biweekly") return { every: 2, unit: "week" };
  if (value === "monthly") return { every: 30, unit: "day" };
  return { every: 1, unit: "week" };
}

function cadenceFromRecurrence(recurrence: Record<string, any>) {
  const every = Math.max(1, Number(recurrence.every || 1));
  const unit = String(recurrence.unit || "day");
  if (unit === "week" && every === 2) return "biweekly";
  if (unit === "week") return "weekly";
  if (unit === "day" && every >= 28) return "monthly";
  return "daily";
}

function recurrenceIntervalMs(recurrence: Record<string, any>) {
  const every = Math.max(1, Math.min(90, Number(recurrence.every || 1)));
  const unit = String(recurrence.unit || "day");
  const unitMs = unit === "hour" ? 3_600_000 : unit === "week" ? 604_800_000 : 86_400_000;
  return every * unitMs;
}

function watchEntity(payload: Record<string, any>, projectId: string) {
  const entity = parseObject(payload.entity);
  const kind = String(entity.kind || payload.entityKind || "project").trim().toLowerCase();
  const id = String(entity.id || payload.entityId || "").trim();
  if (!(SHARED_WORK_WATCH_ENTITY_KINDS as readonly string[]).includes(kind) || !id) {
    throw createHttpError("VALIDATION_FAILED", "Watcher records require a supported Cluster resource with a stable ID.", 400);
  }
  return {
    kind: kind as SharedWorkWatchEntityKind,
    id,
    label: entity.label ? String(entity.label).slice(0, 240) : undefined,
    projectId: entity.projectId ? String(entity.projectId) : projectId,
    href: entity.href ? String(entity.href).slice(0, 1200) : undefined,
  };
}

function watchScope(payload: Record<string, any>): SharedWorkWatchScope {
  const raw = String(payload.eventScope || payload.scope || "all").trim().toLowerCase();
  return (SHARED_WORK_WATCH_SCOPES as readonly string[]).includes(raw) ? raw as SharedWorkWatchScope : "all";
}

async function listDependencies(prisma: any, projectIds: string[]) {
  const rows = await prisma.projectRelationship.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: [{ critical: "desc" }, { createdAt: "desc" }],
    take: 5_000,
  });
  return rows.map((row: any) => wrapper("dependency", row.projectId, row.id, {
    id: row.id,
    projectId: row.projectId,
    source: { kind: row.sourceType, id: row.sourceId, label: row.sourceId, projectId: row.projectId },
    target: { kind: row.targetType, id: row.targetId, label: row.targetId, projectId: row.projectId },
    relationship: row.relationship,
    status: row.critical ? "blocked" : "open",
    notes: row.description || null,
    critical: Boolean(row.critical),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt || row.createdAt),
  }, row));
}

async function listRecurring(prisma: any, projectIds: string[]) {
  const rows = await prisma.projectControlRecord.findMany({
    where: { projectId: { in: projectIds }, kind: "automation", archived: false },
    orderBy: { updatedAt: "desc" },
    take: 5_000,
  });
  return rows.flatMap((row: any) => {
    const stored = parseObject(row.payload);
    if (String(stored.trigger || "") !== "recurring") return [];
    const recurrence = parseObject(stored.recurrence);
    const interval = recurrenceIntervalMs(recurrence);
    const last = stored.lastRunAt ? new Date(stored.lastRunAt).getTime() : new Date(row.createdAt).getTime();
    const nextRun = stored.nextRun || new Date(last + interval).toISOString().slice(0, 10);
    return [wrapper("recurring", row.projectId, row.id, {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      targetKind: stored.targetKind || "project",
      cadence: stored.cadence || cadenceFromRecurrence(recurrence),
      nextRun,
      ownerId: row.ownerId || null,
      ownerName: stored.ownerName || null,
      checklist: stored.checklist || null,
      status: row.status === "paused" || stored.enabled === false ? "paused" : "active",
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      lastGeneratedAt: stored.lastRunAt || null,
      canonicalAutomation: true,
    }, row)];
  });
}

async function listWatchers(prisma: any, projectIds: string[]) {
  const rows = await prisma.clusterPersistenceRecord.findMany({
    where: { projectId: { in: projectIds }, kind: "sharedWorkWatcher", archived: false },
    orderBy: { updatedAt: "desc" },
    take: 5_000,
  });
  return rows.map((row: any) => {
    const stored = parseObject(row.payload);
    const entity = parseObject(stored.entity);
    return wrapper("watcher", row.projectId, row.id, {
      id: row.id,
      entity: {
        kind: entity.kind || row.entityType,
        id: entity.id || row.entityId,
        label: entity.label || row.title?.replace(/^Watch\s+/i, "") || row.entityId,
        projectId: entity.projectId || row.projectId,
        href: entity.href || null,
      },
      userId: row.userId || stored.userId || null,
      userName: stored.userName || row.userId || "Studio member",
      eventScope: stored.scope || row.sourceKey || "all",
      muted: stored.muted === true || row.status === "muted",
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      canonicalSubscription: true,
    }, row);
  });
}

export async function listCanonicalProjectWorkflowRecords(prisma: any, kind: CanonicalProjectWorkflowKind, projectIds: string[]) {
  if (!projectIds.length) return [];
  if (kind === "dependency") return listDependencies(prisma, projectIds);
  if (kind === "recurring") return listRecurring(prisma, projectIds);
  return listWatchers(prisma, projectIds);
}

export async function getCanonicalProjectWorkflowRecord(prisma: any, kind: CanonicalProjectWorkflowKind, projectId: string, entityId: string) {
  const records = await listCanonicalProjectWorkflowRecords(prisma, kind, [projectId]);
  return records.find((record: any) => record.entityId === entityId || record.id === entityId) || null;
}

export async function upsertCanonicalProjectWorkflowRecord(input: {
  prisma: any;
  kind: CanonicalProjectWorkflowKind;
  project: any;
  entityId: string;
  payload: Record<string, any>;
  actorUserId?: string | null;
  expectedRevision?: number;
}) {
  const { prisma, kind, project, entityId, payload, actorUserId, expectedRevision } = input;
  if (kind === "dependency") {
    const source = parseObject(payload.source);
    const target = parseObject(payload.target);
    const sourceType = String(source.kind || "").trim();
    const sourceId = String(source.id || "").trim();
    const targetType = String(target.kind || "").trim();
    const targetId = String(target.id || "").trim();
    if (!sourceType || !sourceId || !targetType || !targetId) throw createHttpError("VALIDATION_FAILED", "Dependencies must link existing Cluster resources with stable IDs.", 400);
    const relationship = normalizeRelationship(payload.relationship);
    const existingById = await prisma.projectRelationship.findFirst({ where: { id: entityId, projectId: project.id } });
    const existing = existingById || await prisma.projectRelationship.findUnique({
      where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType, sourceId, targetType, targetId, relationship } },
    });
    const data = { sourceType, sourceId, targetType, targetId, relationship, description: payload.notes || payload.description || null, critical: Boolean(payload.critical || payload.status === "blocked"), createdById: actorUserId || null };
    if (expectedRevision && (!existing || Number(existing.revision || 1) !== expectedRevision)) {
      throw createHttpError("REVISION_CONFLICT", "This dependency changed on the server.", 409);
    }
    let row: any;
    if (existing) {
      if (expectedRevision) {
        const updated = await prisma.projectRelationship.updateMany({ where: { id: existing.id, projectId: project.id, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } });
        if (updated.count !== 1) throw createHttpError("REVISION_CONFLICT", "This dependency changed on the server.", 409);
        row = await prisma.projectRelationship.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        row = await prisma.projectRelationship.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
      }
    } else {
      row = await prisma.projectRelationship.create({ data: { id: entityId, projectId: project.id, ...data, revision: 1 } });
    }
    return (await getCanonicalProjectWorkflowRecord(prisma, kind, project.id, row.id))!;
  }

  if (kind === "recurring") {
    const recurrence = recurrenceFromCadence(payload.cadence);
    const nextRun = payload.nextRun ? new Date(`${String(payload.nextRun).slice(0, 10)}T00:00:00.000Z`) : null;
    const seededLastRunAt = nextRun && !Number.isNaN(nextRun.getTime()) ? new Date(nextRun.getTime() - recurrenceIntervalMs(recurrence)).toISOString() : undefined;
    const stored = {
      trigger: "recurring",
      recurrence,
      actions: Array.isArray(payload.actions) && payload.actions.length ? payload.actions : [{ type: "log_activity", title: String(payload.title || "Recurring project work") }],
      enabled: payload.status !== "paused",
      governance: { state: "published", version: 1, updatedAt: new Date().toISOString(), updatedById: actorUserId || null },
      ...(seededLastRunAt ? { lastRunAt: seededLastRunAt } : {}),
      targetKind: payload.targetKind || "project",
      cadence: payload.cadence || "weekly",
      nextRun: payload.nextRun || null,
      ownerName: payload.ownerName || null,
      checklist: payload.checklist || null,
    };
    const existing = await prisma.projectControlRecord.findFirst({ where: { id: entityId, projectId: project.id, kind: "automation", archived: false } });
    const data = { title: String(payload.title || "Recurring project work").slice(0, 240), description: payload.checklist ? String(payload.checklist).slice(0, 8000) : null, status: payload.status === "paused" ? "paused" : "active", priority: "medium", ownerId: payload.ownerId || actorUserId || null, category: `recurring:${entityId}`, payload: JSON.stringify(stored), progress: 0 };
    if (expectedRevision && (!existing || Number(existing.revision || 1) !== expectedRevision)) {
      throw createHttpError("REVISION_CONFLICT", "This recurring workflow changed on the server.", 409);
    }
    let row: any;
    if (existing) {
      if (expectedRevision) {
        const updated = await prisma.projectControlRecord.updateMany({ where: { id: existing.id, projectId: project.id, kind: "automation", archived: false, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } });
        if (updated.count !== 1) throw createHttpError("REVISION_CONFLICT", "This recurring workflow changed on the server.", 409);
        row = await prisma.projectControlRecord.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        row = await prisma.projectControlRecord.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
      }
    } else {
      row = await prisma.projectControlRecord.create({ data: { id: entityId, projectId: project.id, kind: "automation", ...data, revision: 1 } });
    }
    return (await getCanonicalProjectWorkflowRecord(prisma, kind, project.id, row.id))!;
  }

  if (kind === "watcher") {
    const entity = watchEntity(payload, project.id);
    const userId = String(payload.userId || actorUserId || "").trim();
    if (!userId) throw createHttpError("VALIDATION_FAILED", "Watcher records require a user.", 400);
    const workspaceMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId, user: { archived: false } }, select: { userId: true } });
    if (!workspaceMember) throw createHttpError("VALIDATION_FAILED", "Watcher must be an active workspace member.", 400);
    if (expectedRevision) {
      const current = await prisma.clusterPersistenceRecord.findFirst({ where: { id: entityId, projectId: project.id, kind: "sharedWorkWatcher", archived: false } });
      if (!current || Number(current.revision || 1) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This watcher changed on the server.", 409);
    }
    const subscriptions = createSubscriptionService(prisma);
    const result = await subscriptions.set({ entity, userId, scopes: [watchScope(payload)], muted: Boolean(payload.muted) });
    const record = result.records[0];
    if (!record?.id) throw createHttpError("WORKFLOW_AUTHORITY_FAILED", "The canonical watcher subscription could not be created.", 500);
    return (await getCanonicalProjectWorkflowRecord(prisma, kind, project.id, record.id))!;
  }


}

export async function deleteCanonicalProjectWorkflowRecord(input: { prisma: any; kind: CanonicalProjectWorkflowKind; project: any; entityId: string; expectedRevision?: number }) {
  const { prisma, kind, project, entityId, expectedRevision } = input;
  if (kind === "dependency") {
    const result = await prisma.projectRelationship.deleteMany({ where: { id: entityId, projectId: project.id, ...(expectedRevision ? { revision: expectedRevision } : {}) } });
    if (expectedRevision && result.count !== 1) throw createHttpError("REVISION_CONFLICT", "This dependency changed on the server.", 409);
    return { ok: true, archived: true };
  }
  if (kind === "recurring") {
    const result = await prisma.projectControlRecord.updateMany({ where: { id: entityId, projectId: project.id, kind: "automation", archived: false, ...(expectedRevision ? { revision: expectedRevision } : {}) }, data: { archived: true, revision: { increment: 1 } } });
    if (expectedRevision && result.count !== 1) throw createHttpError("REVISION_CONFLICT", "This recurring workflow changed on the server.", 409);
    return { ok: true, archived: true };
  }
  if (kind === "watcher") {
    const row = await prisma.clusterPersistenceRecord.findFirst({ where: { id: entityId, projectId: project.id, kind: "sharedWorkWatcher", archived: false } });
    if (!row) {
      if (expectedRevision) throw createHttpError("REVISION_CONFLICT", "This watcher changed on the server.", 409);
      return { ok: true, archived: true };
    }
    if (expectedRevision && Number(row.revision || 1) !== expectedRevision) throw createHttpError("REVISION_CONFLICT", "This watcher changed on the server.", 409);
    const stored = parseObject(row.payload);
    const entity = parseObject(stored.entity);
    const subscriptions = createSubscriptionService(prisma);
    await subscriptions.remove({ kind: (entity.kind || row.entityType) as any, id: String(entity.id || row.entityId), projectId: entity.projectId || row.projectId || undefined }, String(row.userId || stored.userId || ""), (stored.scope || row.sourceKey || null) as SharedWorkWatchScope | null);
    return { ok: true, archived: true };
  }
  return { ok: true, archived: true };
}
