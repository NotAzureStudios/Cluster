import { createHash } from "node:crypto";import type { FastifyInstance, FastifyRequest } from "fastify";

import { z } from "zod";
import { createHttpError } from "../../core/http-errors.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { deleteCanonicalProjectWorkflowRecord, getCanonicalProjectWorkflowRecord, isCanonicalProjectWorkflowKind, listCanonicalProjectWorkflowRecords, upsertCanonicalProjectWorkflowRecord } from "./project-workflow-authority.js";

export const PROJECT_WORKFLOW_KINDS = [
  "dependency",
  "recurring",
  "watcher",
  "meeting",
  "versionSnapshot",
  "boardView",
  "whiteboardComponent",
] as const;

type ProjectWorkflowKind = (typeof PROJECT_WORKFLOW_KINDS)[number];

type ProjectWorkflowRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  buildPersistenceStorageData: (kind: string, payload: Record<string, any>, recordId?: string | null) => Record<string, unknown>;
  logPersistenceAudit: (input: { recordId?: string | null; kind: string; action: string; actorId?: string | null; summary: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  parseJsonObject: (value: unknown) => Record<string, any>;
};

const kindSchema = z.enum(PROJECT_WORKFLOW_KINDS);
const paramsSchema = z.object({ projectId: z.string().trim().min(1), kind: kindSchema });
const entityParamsSchema = paramsSchema.extend({ entityId: z.string().trim().min(1).max(180) });
const bulkParamsSchema = z.object({ kind: kindSchema });
const bulkQuerySchema = z.object({ projectIds: z.string().trim().min(1) });
const payloadSchema = z.record(z.unknown());
const upsertSchema = z.object({
  payload: payloadSchema,
  expectedRevision: z.number().int().positive().optional(),
});

const WORKFLOW_RESOURCE_KINDS = new Set(["project", "board", "timeline"]);

function workflowRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind || "").trim().toLowerCase();
  const id = String(raw.id || "").trim();
  const projectId = raw.projectId ? String(raw.projectId).trim() : null;
  return kind && id ? { kind, id, projectId } : null;
}

async function enforceWorkflowResourceAccess(input: {
  prisma: any;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  request: FastifyRequest;
  reply: any;
  project: any;
  resource: { kind: string; id: string; projectId?: string | null };
  min: "view" | "contribute";
  allowCrossProjectTarget?: boolean;
}) {
  const { prisma, enforceTargetAccess, request, reply, project, resource, min, allowCrossProjectTarget = false } = input;
  if (!WORKFLOW_RESOURCE_KINDS.has(resource.kind)) {
    throw createHttpError("VALIDATION_FAILED", "Project workflow dependencies support Project, Board, or Timeline resources.", 400);
  }
  if (resource.kind === "project") {
    if (resource.id === project.id) return true;
    if (!allowCrossProjectTarget) throw createHttpError("VALIDATION_FAILED", "The relationship source project must match the workflow context.", 400);
    const targetProject = await prisma.project.findUnique({ where: { id: resource.id } });
    if (!targetProject || targetProject.archived || targetProject.workspaceId !== project.workspaceId) throw createHttpError("VALIDATION_FAILED", "Target project is not available in this workspace.", 400);
    return enforceTargetAccess(request, reply, "project", targetProject.id, targetProject, min);
  }
  if (resource.projectId && resource.projectId !== project.id) throw createHttpError("VALIDATION_FAILED", "Workflow resource project does not match the current project.", 400);
  const found = resource.kind === "board"
    ? await prisma.board.findFirst({ where: { id: resource.id, projectId: project.id, archived: false }, select: { id: true } })
    : await prisma.timelineItem.findFirst({ where: { id: resource.id, projectId: project.id }, select: { id: true } });
  if (!found) throw createHttpError("VALIDATION_FAILED", `${resource.kind} does not belong to this project.`, 400);
  return enforceTargetAccess(request, reply, resource.kind, resource.id, project, min);
}

function workflowRecordId(projectId: string, kind: ProjectWorkflowKind, entityId: string) {
  const digest = createHash("sha256").update(`${projectId}:${kind}:${entityId}`).digest("hex").slice(0, 32);
  return `project_workflow_${digest}`;
}

function safePayload(value: Record<string, unknown>) {
  const json = JSON.stringify(value || {});
  if (json.length > 256_000) throw createHttpError("VALIDATION_FAILED", "Project workflow record is too large.", 400);
  return json;
}

function titleFor(kind: ProjectWorkflowKind, payload: Record<string, any>, fallback: string) {
  const title = payload.title || payload.name || payload.label || payload.collaboratorName || payload.build || payload.version;
  return String(title || `${kind} ${fallback}`).trim().slice(0, 180);
}

function statusFor(payload: Record<string, any>) {
  return String(payload.status || payload.approvalState || payload.decision || payload.state || "active").slice(0, 80);
}

function serializeWorkflowRecord(record: any, parseJsonObject: (value: unknown) => Record<string, any>) {
  return {
    id: record.id,
    kind: record.kind,
    projectId: record.projectId,
    entityId: record.entityId,
    revision: Number(record.revision || 1),
    validationState: record.validationState || "unchecked",
    validationSummary: record.validationSummary || null,
    syncedAt: record.syncedAt?.toISOString?.() || record.syncedAt || null,
    createdAt: record.createdAt?.toISOString?.() || record.createdAt,
    updatedAt: record.updatedAt?.toISOString?.() || record.updatedAt,
    payload: parseJsonObject(record.payload),
  };
}

async function ensureProject(prisma: any, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.archived) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return project;
}

function normalizedPayload(projectId: string, entityId: string, payload: Record<string, any>, existingPayload?: Record<string, any>): Record<string, any> {
  const now = new Date().toISOString();
  return {
    ...(existingPayload || {}),
    ...payload,
    id: entityId,
    projectId,
    createdAt: payload.createdAt || existingPayload?.createdAt || now,
    updatedAt: now,
  };
}

export function registerProjectWorkflowRoutes(deps: ProjectWorkflowRouteDependencies) {
  const { app, prisma, getCurrentUser, enforceTargetAccess, buildPersistenceStorageData, logPersistenceAudit, logActivity, parseJsonObject } = deps;

  app.get("/api/project-workflows/:kind", async (request, reply) => {
    const params = bulkParamsSchema.parse(request.params);
    const query = bulkQuerySchema.parse(request.query);
    const projectIds: string[] = Array.from(new Set<string>(query.projectIds.split(",").map((value) => value.trim()).filter(Boolean))).slice(0, 100);
    if (!projectIds.length) return { kind: params.kind, projectIds: [], records: [] };
    const projects = await prisma.project.findMany({ where: { id: { in: projectIds }, archived: false } });
    if (projects.length !== projectIds.length) throw createHttpError("PROJECT_NOT_FOUND", "One or more projects were not found.", 404);
    const projectsById = new Map(projects.map((project: any) => [project.id, project]));
    for (const projectId of projectIds) {
      const project = projectsById.get(projectId);
      if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "view"))) return;
    }
    if (isCanonicalProjectWorkflowKind(params.kind)) {
      const records = await listCanonicalProjectWorkflowRecords(prisma, params.kind, projectIds);
      return { kind: params.kind, projectIds, records };
    }
    const records = await prisma.clusterPersistenceRecord.findMany({
      where: { projectId: { in: projectIds }, kind: params.kind, archived: false },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    return { kind: params.kind, projectIds, records: records.map((record: any) => serializeWorkflowRecord(record, parseJsonObject)) };
  });

  app.get("/api/projects/:projectId/workflows/:kind", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    if (isCanonicalProjectWorkflowKind(params.kind)) {
      const records = await listCanonicalProjectWorkflowRecords(prisma, params.kind, [project.id]);
      return { projectId: project.id, kind: params.kind, records };
    }
    const records = await prisma.clusterPersistenceRecord.findMany({
      where: { projectId: project.id, kind: params.kind, archived: false },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    });
    return { projectId: project.id, kind: params.kind, records: records.map((record: any) => serializeWorkflowRecord(record, parseJsonObject)) };
  });

  app.get("/api/projects/:projectId/workflows/:kind/:entityId", async (request, reply) => {
    const params = entityParamsSchema.parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    if (isCanonicalProjectWorkflowKind(params.kind)) {
      const record = await getCanonicalProjectWorkflowRecord(prisma, params.kind, project.id, params.entityId);
      if (!record) throw createHttpError("RESOURCE_NOT_FOUND", "Project workflow record not found.", 404);
      return record;
    }
    const record = await prisma.clusterPersistenceRecord.findFirst({
      where: { projectId: project.id, kind: params.kind, entityId: params.entityId, archived: false, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (!record) throw createHttpError("RESOURCE_NOT_FOUND", "Project workflow record not found.", 404);
    return serializeWorkflowRecord(record, parseJsonObject);
  });

  app.put("/api/projects/:projectId/workflows/:kind/:entityId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = entityParamsSchema.parse(request.params);
    const body = upsertSchema.parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    const incomingPayload = body.payload as Record<string, any>;
    const watcherTargetUserId = String(incomingPayload.userId || user?.id || "");
    const requiresManage = params.kind === "watcher" && watcherTargetUserId !== String(user?.id || "");
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, requiresManage ? "manage" : "contribute"))) return;
    if (isCanonicalProjectWorkflowKind(params.kind)) {
      if (params.kind === "dependency") {
        const source = workflowRef(incomingPayload.source);
        const target = workflowRef(incomingPayload.target);
        if (!source || !target) throw createHttpError("VALIDATION_FAILED", "Dependencies require stable source and target resources.", 400);
        if (!(await enforceWorkflowResourceAccess({ prisma, enforceTargetAccess, request, reply, project, resource: source, min: "contribute" }))) return;
        if (!(await enforceWorkflowResourceAccess({ prisma, enforceTargetAccess, request, reply, project, resource: target, min: "view", allowCrossProjectTarget: true }))) return;
      } else if (params.kind === "watcher") {
        const target = workflowRef(incomingPayload.entity);
        if (!target) throw createHttpError("VALIDATION_FAILED", "Followers require a stable Project, Board, or Timeline resource.", 400);
        if (!(await enforceWorkflowResourceAccess({ prisma, enforceTargetAccess, request, reply, project, resource: target, min: "view" }))) return;
      }
      const record = await upsertCanonicalProjectWorkflowRecord({ prisma, kind: params.kind, project, entityId: params.entityId, payload: incomingPayload, actorUserId: user?.id || null, expectedRevision: body.expectedRevision });
      await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: `project_${params.kind}`, entityId: record.entityId, title: `${params.kind} updated`, message: record.validationSummary || "Canonical workflow authority updated." });
      return record;
    }
    const existing = await prisma.clusterPersistenceRecord.findFirst({
      where: { projectId: project.id, kind: params.kind, entityId: params.entityId },
      orderBy: { updatedAt: "desc" },
    });
    if (body.expectedRevision && (!existing || existing.archived || Number(existing.revision || 1) !== body.expectedRevision)) {
      reply.code(409);
      return {
        ok: false,
        code: "REVISION_CONFLICT",
        error: existing?.archived ? "This project workflow record was removed on the server." : "This project workflow record changed on the server.",
        current: existing ? serializeWorkflowRecord(existing, parseJsonObject) : null,
      };
    }
    const currentPayload = existing ? parseJsonObject(existing.payload) : undefined;
    const payload = normalizedPayload(project.id, params.entityId, body.payload as Record<string, any>, currentPayload) as Record<string, any>;
    const data = {
      title: titleFor(params.kind, payload, params.entityId),
      projectId: project.id,
      entityType: params.kind,
      entityId: params.entityId,
      ownerId: payload["ownerId"] ? String(payload["ownerId"]) : null,
      userId: payload["userId"] ? String(payload["userId"]) : null,
      status: statusFor(payload),
      visibility: payload["visibility"] ? String(payload["visibility"]) : "internal",
      sourceKey: "project-workflow-api",
      ...buildPersistenceStorageData(params.kind, payload, existing?.id || null),
      payload: safePayload(payload),
      archived: false,
      deletedAt: null,
      syncedAt: new Date(),
    };
    let record: any;
    if (existing && body.expectedRevision) {
      const updated = await prisma.clusterPersistenceRecord.updateMany({
        where: { id: existing.id, revision: body.expectedRevision, archived: false },
        data: { ...data, revision: { increment: 1 } },
      });
      if (updated.count !== 1) {
        const current = await prisma.clusterPersistenceRecord.findUnique({ where: { id: existing.id } });
        reply.code(409);
        return {
          ok: false,
          code: "REVISION_CONFLICT",
          error: current?.archived ? "This project workflow record was removed on the server." : "This project workflow record changed on the server.",
          current: current ? serializeWorkflowRecord(current, parseJsonObject) : null,
        };
      }
      record = await prisma.clusterPersistenceRecord.findUniqueOrThrow({ where: { id: existing.id } });
    } else if (existing) {
      record = await prisma.clusterPersistenceRecord.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
    } else {
      const id = workflowRecordId(project.id, params.kind, params.entityId);
      record = await prisma.clusterPersistenceRecord.upsert({
        where: { id },
        create: { id, kind: params.kind, ...data, revision: 1 },
        update: { ...data, revision: { increment: 1 } },
      });
    }
    await logPersistenceAudit({
      recordId: record.id,
      kind: params.kind,
      action: existing ? "project_workflow_updated" : "project_workflow_created",
      actorId: user?.id || null,
      summary: `${existing ? "Updated" : "Created"} ${params.kind}: ${record.title}`,
      metadata: { projectId: project.id, entityId: params.entityId, revision: record.revision },
    });
    await logActivity({
      userId: user?.id,
      projectId: project.id,
      type: existing ? "updated" : "created",
      entityType: `project_${params.kind}`,
      entityId: params.entityId,
      title: `${params.kind} ${existing ? "updated" : "created"}`,
      message: record.title,
    });
    return serializeWorkflowRecord(record, parseJsonObject);
  });

  app.delete("/api/projects/:projectId/workflows/:kind/:entityId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = entityParamsSchema.parse(request.params);
    const query = z.object({ expectedRevision: z.coerce.number().int().positive().optional() }).parse(request.query);
    const project = await ensureProject(prisma, params.projectId);
    if (isCanonicalProjectWorkflowKind(params.kind)) {
      const existing = await getCanonicalProjectWorkflowRecord(prisma, params.kind, project.id, params.entityId);
      const watcherUserId = params.kind === "watcher" ? String(existing?.payload?.userId || "") : "";
      const requiresManage = params.kind === "watcher" && watcherUserId && watcherUserId !== String(user?.id || "");
      if (!(await enforceTargetAccess(request, reply, "project", project.id, project, requiresManage ? "manage" : "contribute"))) return;
      const result = await deleteCanonicalProjectWorkflowRecord({ prisma, kind: params.kind, project, entityId: params.entityId, expectedRevision: query.expectedRevision });
      await logActivity({ userId: user?.id, projectId: project.id, type: "archived", entityType: `project_${params.kind}`, entityId: params.entityId, title: `${params.kind} removed`, message: "Canonical workflow authority updated." });
      return result;
    }
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const existing = await prisma.clusterPersistenceRecord.findFirst({
      where: { projectId: project.id, kind: params.kind, entityId: params.entityId },
      orderBy: { updatedAt: "desc" },
    });
    if (!existing || existing.archived) return { ok: true, archived: Boolean(existing?.archived), revision: existing?.revision || null };
    if (query.expectedRevision && Number(existing.revision || 1) !== query.expectedRevision) {
      reply.code(409);
      return { ok: false, code: "REVISION_CONFLICT", error: "This project workflow record changed on the server.", current: serializeWorkflowRecord(existing, parseJsonObject) };
    }
    let record: any;
    if (query.expectedRevision) {
      const updated = await prisma.clusterPersistenceRecord.updateMany({
        where: { id: existing.id, revision: query.expectedRevision, archived: false },
        data: { archived: true, deletedAt: new Date(), syncedAt: new Date(), revision: { increment: 1 } },
      });
      if (updated.count !== 1) {
        const current = await prisma.clusterPersistenceRecord.findUnique({ where: { id: existing.id } });
        reply.code(409);
        return { ok: false, code: "REVISION_CONFLICT", error: "This project workflow record changed on the server.", current: current ? serializeWorkflowRecord(current, parseJsonObject) : null };
      }
      record = await prisma.clusterPersistenceRecord.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      record = await prisma.clusterPersistenceRecord.update({
        where: { id: existing.id },
        data: { archived: true, deletedAt: new Date(), syncedAt: new Date(), revision: { increment: 1 } },
      });
    }
    await logPersistenceAudit({ recordId: record.id, kind: params.kind, action: "project_workflow_archived", actorId: user?.id || null, summary: `Archived ${params.kind}: ${record.title}`, metadata: { projectId: project.id, entityId: params.entityId } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "archived", entityType: `project_${params.kind}`, entityId: params.entityId, title: `${params.kind} archived`, message: record.title });
    return { ok: true, archived: true, revision: record.revision };
  });


}
