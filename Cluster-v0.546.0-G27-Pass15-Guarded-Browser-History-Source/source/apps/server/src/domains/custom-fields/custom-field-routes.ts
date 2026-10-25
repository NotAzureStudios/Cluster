import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CLUSTER_CUSTOM_FIELD_ENTITIES,
  clusterCustomFieldDefinitionSchema,
  clusterCustomFieldValueSchema,
  type ClusterCustomFieldAccess,
  type ClusterCustomFieldEntity,
} from "@cluster/shared";
import { createHttpError } from "../../core/http-errors.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { AuthorizationService } from "../access/authorization.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

const DEFAULT_CUSTOM_FIELDS = [
  { id: "ticket-impact", label: "Impact", slug: "impact", entity: "ticket", fieldType: "select", options: ["Individual", "Department", "Project", "Studio"], enabled: true, filterable: true, viewAccess: "everyone", editAccess: "members" },
  { id: "ticket-environment", label: "Environment", slug: "environment", entity: "ticket", fieldType: "text", enabled: true, filterable: true, viewAccess: "everyone", editAccess: "members" },
  { id: "project-client-code", label: "Client code", slug: "client-code", entity: "project", fieldType: "text", enabled: true, filterable: true, viewAccess: "members", editAccess: "managers" },
  { id: "build-target", label: "Target channel", slug: "target-channel", entity: "build", fieldType: "select", options: ["Internal", "QA", "Staging", "Release"], enabled: true, filterable: true, viewAccess: "everyone", editAccess: "members" },
] as const;

type CustomFieldEntity = ClusterCustomFieldEntity;
type CustomFieldAccess = ClusterCustomFieldAccess;

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  hasTargetAccess: (...args: any[]) => boolean;
  authorization: AuthorizationService;
  buildPersistenceStorageData: (kind: string, payload: Record<string, any>, recordId?: string | null) => Record<string, unknown>;
  logPersistenceAudit: (input: { recordId?: string | null; kind: string; action: string; actorId?: string | null; summary: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  parseJsonObject: (value: unknown) => Record<string, any>;
};

const definitionSchema = clusterCustomFieldDefinitionSchema;
const definitionUpsertSchema = z.object({ payload: definitionSchema, expectedRevision: z.number().int().positive().optional() });
const valueSchema = clusterCustomFieldValueSchema;
const valueUpsertSchema = z.object({ payload: valueSchema, expectedRevision: z.number().int().positive().optional() });
const valueQuerySchema = z.object({ entity: z.enum(CLUSTER_CUSTOM_FIELD_ENTITIES), entries: z.array(z.object({ entityId: z.string().trim().min(1).max(180), projectId: z.string().trim().max(180).nullable().optional() })).min(1).max(500) });
const valueParamsSchema = z.object({ entity: z.enum(CLUSTER_CUSTOM_FIELD_ENTITIES), entityId: z.string().trim().min(1).max(180), fieldId: z.string().trim().min(1).max(180) });

function recordId(kind: "customFieldDefinition" | "customFieldValue", identity: string) {
  return `${kind}_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}
function jsonPayload(value: Record<string, unknown>) {
  const json = JSON.stringify(value || {});
  if (json.length > 256_000) throw createHttpError("VALIDATION_FAILED", "Custom field record is too large.", 400);
  return json;
}
function serialize(record: any, parseJsonObject: Dependencies["parseJsonObject"]) {
  return {
    id: record.id,
    entityId: record.entityId,
    revision: Number(record.revision || 1),
    createdAt: record.createdAt?.toISOString?.() || record.createdAt,
    updatedAt: record.updatedAt?.toISOString?.() || record.updatedAt,
    payload: parseJsonObject(record.payload),
  };
}
function minimumFor(access: CustomFieldAccess | undefined, mode: "view" | "edit") {
  const required = access || (mode === "edit" ? "members" : "everyone");
  return required === "admins" ? "admin" : required === "managers" ? "manage" : required === "members" ? "contribute" : "view";
}

function fieldAccessRank(access: unknown) {
  return access === "admins" ? 3 : access === "managers" ? 2 : access === "members" ? 1 : 0;
}
function strictestFieldAccess(viewAccess: CustomFieldAccess | undefined, editAccess: CustomFieldAccess | undefined): CustomFieldAccess {
  const view = viewAccess || "everyone";
  const edit = editAccess || "members";
  return fieldAccessRank(view) >= fieldAccessRank(edit) ? view : edit;
}

function toolForEntity(entity: CustomFieldEntity) {
  if (entity === "ticket" || entity === "issue") return "tickets";
  if (entity === "card" || entity === "board") return "boards";
  if (entity === "whiteboard") return "whiteboards";
  if (entity === "calendar") return "calendar";
  if (entity === "time") return "scheduler";
  if (entity === "file") return "library";
  if (entity === "library") return "library";
  if (entity === "qa") return "qa";
  if (entity === "build") return "builds";
  if (entity === "user") return "people";
  return "projects";
}

function targetKindForEntity(entity: CustomFieldEntity) {
  if (entity === "ticket" || entity === "issue") return "ticket";
  if (entity === "card") return "card";
  if (entity === "library") return "library";
  return entity;
}

type ResolvedCustomFieldEntity = {
  targetKind: string;
  targetId: string;
  project: any | null;
  ownerUserId?: string | null;
  boardId?: string | null;
  workItemKind?: string | null;
  calendarEvent?: any | null;
};

async function projectById(prisma: any, projectId: string | null | undefined) {
  const id = String(projectId || "").trim();
  return id ? prisma.project.findUnique({ where: { id } }) : null;
}

async function resolveEntityContext(prisma: any, entity: CustomFieldEntity, entityId: string, projectId?: string | null): Promise<ResolvedCustomFieldEntity> {
  const hintedProjectId = String(projectId || "").trim();
  let project: any | null = null;
  let ownerUserId: string | null | undefined;
  let boardId: string | null | undefined;
  let workItemKind: string | null | undefined;
  let calendarEvent: any | null | undefined;
  let found = true;

  if (entity === "project") {
    project = await prisma.project.findUnique({ where: { id: entityId } });
    found = Boolean(project);
  } else if (entity === "board") {
    const record = await prisma.board.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    found = Boolean(record); project = record?.project || null;
  } else if (entity === "whiteboard") {
    const record = await prisma.whiteboard.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    found = Boolean(record); project = record?.project || null;
  } else if (entity === "calendar") {
    const record = await prisma.calendarEvent.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    found = Boolean(record); project = record?.project || null; ownerUserId = record?.ownerId || null; calendarEvent = record || null;
  } else if (entity === "time") {
    const record = await prisma.timeEntry.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    found = Boolean(record); project = record?.project || null; ownerUserId = record?.userId || null;
  } else if (entity === "file") {
    const record = await prisma.projectFile.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    found = Boolean(record); project = record?.project || null;
  } else if (entity === "library") {
    const record = await prisma.libraryItem.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    found = Boolean(record); project = record?.project || null; ownerUserId = record?.ownerId || null;
  } else if (entity === "ticket" || entity === "issue" || entity === "card") {
    const record = await prisma.card.findUnique({ where: { id: entityId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
    found = Boolean(record); project = record?.list?.board?.project || null; boardId = record?.list?.board?.id || null; workItemKind = record?.workItemKind || null;
  } else if (entity === "user") {
    const record = await prisma.user.findUnique({ where: { id: entityId }, select: { id: true } });
    found = Boolean(record); ownerUserId = record?.id || null;
  } else if (entity === "build" || entity === "qa") {
    const record = entity === "build"
      ? await prisma.deliveryBuild.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } })
      : (await prisma.deliveryQaSession.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } }))
        || (await prisma.deliveryQaPlan.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } }));
    if (record?.projectId) project = await projectById(prisma, record.projectId);
    else if (entity === "build") {
      const timelineBuild = await prisma.timelineItem.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (timelineBuild?.project) project = timelineBuild.project;
      else if (hintedProjectId && entityId === `${hintedProjectId}-build-workspace`) project = await projectById(prisma, hintedProjectId);
    }
    found = Boolean(project);
  }

  if (!found) throw createHttpError("RESOURCE_NOT_FOUND", "Custom field target not found.", 404);
  if (hintedProjectId && project?.id && project.id !== hintedProjectId) {
    throw createHttpError("RESOURCE_NOT_FOUND", "Custom field target does not belong to that project.", 404);
  }
  if (hintedProjectId && !project && !["user", "calendar", "time", "library"].includes(entity)) {
    throw createHttpError("RESOURCE_NOT_FOUND", "Custom field project not found.", 404);
  }
  return { targetKind: targetKindForEntity(entity), targetId: entityId, project, ownerUserId, boardId, workItemKind, calendarEvent };
}

function toolRank(level: string) {
  if (level === "manage") return 2;
  if (level === "edit") return 1;
  if (level === "view") return 0;
  return -1;
}

export function registerCustomFieldRoutes(deps: Dependencies) {
  const { app, prisma, getCurrentUser, decorateUserForClient, enforceTargetAccess, hasTargetAccess, authorization, buildPersistenceStorageData, logPersistenceAudit, logActivity, parseJsonObject } = deps;

  async function ensureDefaultDefinitions() {
    const now = new Date().toISOString();
    for (const raw of DEFAULT_CUSTOM_FIELDS) {
      const id = recordId("customFieldDefinition", raw.id);
      const exists = await prisma.clusterPersistenceRecord.findUnique({ where: { id }, select: { id: true } });
      if (exists) continue;
      const payload = { ...raw, createdAt: now, updatedAt: now };
      try {
        await prisma.clusterPersistenceRecord.create({ data: {
          id, kind: "customFieldDefinition", title: raw.label, entityType: raw.entity, entityId: raw.id, status: "active", visibility: raw.viewAccess,
          sourceKey: "custom-field-defaults", ...buildPersistenceStorageData("customFieldDefinition", payload), payload: jsonPayload(payload), archived: false, syncedAt: new Date(), revision: 1,
        } });
      } catch (error) {
        if ((error as { code?: string })?.code !== "P2002") throw error;
      }
    }
  }

  async function guardedUpdate(reply: FastifyReply, existing: any, expectedRevision: number | undefined, data: Record<string, unknown>, message: string) {
    const expected = expectedRevision || Number(existing.revision || 1);
    const result = await prisma.clusterPersistenceRecord.updateMany({ where: { id: existing.id, revision: expected }, data: { ...data, revision: { increment: 1 } } });
    if (result.count !== 1) {
      const current = await prisma.clusterPersistenceRecord.findUnique({ where: { id: existing.id } });
      reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: message, current: current ? serialize(current, parseJsonObject) : null });
      return null;
    }
    return prisma.clusterPersistenceRecord.findUnique({ where: { id: existing.id } });
  }

  async function visibleDefinitionRecords(request: FastifyRequest, records: any[], includeArchived = false) {
    const current = await getCurrentUser(request);
    const decorated = current ? await decorateUserForClient(current) : null;
    if (!current) return [];
    if (decorated?.isAdmin) return includeArchived ? records : records.filter((record: any) => !record.archived);
    const role = decorated?.workspaceRole;
    const visible = records.filter((record: any) => {
      if (record.archived) return false;
      const payload = parseJsonObject(record.payload);
      if (payload.enabled === false || payload.archivedAt) return false;
      const entity = payload.entity as CustomFieldEntity | undefined;
      if (!entity || !CLUSTER_CUSTOM_FIELD_ENTITIES.includes(entity)) return false;
      const rank = toolRank(authorization.getToolPermissionLevel(current, role, toolForEntity(entity)));
      const required = minimumFor(payload.viewAccess as CustomFieldAccess | undefined, "view");
      const requiredRank = required === "admin" ? 3 : required === "manage" ? 2 : required === "contribute" ? 1 : 0;
      return rank >= requiredRank;
    });
    const visibleIds = new Set(visible.map((record: any) => String(record.entityId || parseJsonObject(record.payload).id || "")));
    return visible.map((record: any) => {
      const payload = parseJsonObject(record.payload);
      if (payload.showWhenFieldId && !visibleIds.has(String(payload.showWhenFieldId))) {
        const sanitized = { ...payload };
        delete sanitized.showWhenFieldId;
        delete sanitized.showWhenValue;
        return { ...record, payload: jsonPayload(sanitized) };
      }
      return record;
    });
  }

  async function definitionFor(fieldId: string) {
    const record = await prisma.clusterPersistenceRecord.findFirst({ where: { kind: "customFieldDefinition", entityId: fieldId, archived: false }, orderBy: { updatedAt: "desc" } });
    return record ? { record, payload: parseJsonObject(record.payload) } : null;
  }
  async function requestAccessRank(request: FastifyRequest, entity: CustomFieldEntity, entityId: string, projectId?: string | null) {
    const current = await getCurrentUser(request);
    const decorated = current ? await decorateUserForClient(current) : null;
    if (decorated?.isAdmin) return 3;
    if (!current) return -1;
    const context = await resolveEntityContext(prisma, entity, entityId, projectId);
    const role = decorated?.workspaceRole;
    if (entity === "calendar" && context.calendarEvent) {
      if (await canAccessCalendarEvent(authorization, request, context.calendarEvent, "manage")) return 2;
      if (await canAccessCalendarEvent(authorization, request, context.calendarEvent, "edit")) return 1;
      if (await canAccessCalendarEvent(authorization, request, context.calendarEvent, "view")) return 0;
      return -1;
    }
    const ruleOr: any[] = [];
    if (context.project?.id) ruleOr.push({ targetKind: "project", targetId: context.project.id });
    if (context.boardId) ruleOr.push({ targetKind: "board", targetId: context.boardId });
    if (["library", "file", "board", "whiteboard"].includes(context.targetKind)) ruleOr.push({ targetKind: context.targetKind, targetId: context.targetId });
    const rules = ruleOr.length ? ((await prisma.accessRule?.findMany?.({ where: { status: "active", OR: ruleOr } }).catch(() => [])) || []) : [];
    if (context.project || ["library"].includes(entity)) {
      if (context.boardId && !hasTargetAccess(current, role, "board", context.boardId, context.project, rules, "view")) return -1;
      if (context.workItemKind === "ticket" && !authorization.hasToolPermission(current, role, "tickets", "view")) return -1;
      if (hasTargetAccess(current, role, context.targetKind, context.targetId, context.project, rules, "manage")) return 2;
      if (hasTargetAccess(current, role, context.targetKind, context.targetId, context.project, rules, "contribute")) return 1;
      if (hasTargetAccess(current, role, context.targetKind, context.targetId, context.project, rules, "view")) return 0;
      return -1;
    }
    const tool = toolForEntity(entity);
    const rank = toolRank(authorization.getToolPermissionLevel(current, role, tool));
    if (context.ownerUserId && context.ownerUserId !== current.id) return rank >= 2 ? 2 : -1;
    return rank;
  }
  async function requireValueAccess(request: FastifyRequest, reply: FastifyReply, entity: CustomFieldEntity, entityId: string, projectId: string | null | undefined, fieldId: string, mode: "view" | "edit") {
    const field = await definitionFor(fieldId);
    if (!field) throw createHttpError("CUSTOM_FIELD_NOT_FOUND", "Custom field definition not found.", 404);
    if (field.payload.entity !== entity) throw createHttpError("VALIDATION_FAILED", `Custom field ${fieldId} targets ${field.payload.entity || "another entity"}, not ${entity}.`, 400);
    if (mode === "edit" && (field.payload.enabled === false || field.payload.archivedAt)) throw createHttpError("VALIDATION_FAILED", "Archived or disabled custom fields cannot be edited.", 400);
    const access = minimumFor(mode === "edit"
      ? strictestFieldAccess(field.payload.viewAccess as CustomFieldAccess | undefined, field.payload.editAccess as CustomFieldAccess | undefined)
      : field.payload.viewAccess, mode);
    const context = await resolveEntityContext(prisma, entity, entityId, projectId);
    let allowed = false;
    if (access === "admin") {
      allowed = Boolean(await authorization.requireAdmin(request, reply));
    } else if (entity === "calendar" && context.calendarEvent) {
      const calendarMinimum = access === "manage" ? "manage" : access === "contribute" ? "edit" : "view";
      allowed = await canAccessCalendarEvent(authorization, request, context.calendarEvent, calendarMinimum);
      if (!allowed) reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "Calendar event access denied." });
    } else if (context.project || entity === "library") {
      if (context.boardId && !(await enforceTargetAccess(request, reply, "board", context.boardId, context.project, access))) return null;
      if (context.workItemKind === "ticket" && !(await authorization.requireTool(request, reply, "tickets", access === "view" ? "view" : access === "manage" ? "manage" : "edit"))) return null;
      allowed = Boolean(await enforceTargetAccess(request, reply, context.targetKind, context.targetId, context.project, access));
    } else {
      const minimum = access === "manage" ? "manage" : access === "contribute" ? "edit" : "view";
      if (context.ownerUserId) {
        allowed = Boolean(await authorization.requireUserScope(request, reply, { ownerUserId: context.ownerUserId, tool: toolForEntity(entity), minimum }));
      } else {
        allowed = Boolean(await authorization.requireTool(request, reply, toolForEntity(entity), minimum));
      }
    }
    return allowed ? context : null;
  }

  app.get("/api/custom-fields/definitions", async (request) => {
    const current = await getCurrentUser(request);
    if (!current) throw createHttpError("AUTH_REQUIRED", "Sign in to view custom fields.", 401);
    await ensureDefaultDefinitions();
    const query = z.object({ archived: z.coerce.boolean().optional() }).parse(request.query || {});
    const decorated = await decorateUserForClient(current);
    const includeArchived = Boolean(query.archived && decorated?.isAdmin);
    const records = await prisma.clusterPersistenceRecord.findMany({
      where: { kind: "customFieldDefinition", ...(includeArchived ? {} : { archived: false }) },
      orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
      take: 1000,
    });
    const visible = await visibleDefinitionRecords(request, records, includeArchived);
    return { records: visible.map((record: any) => serialize(record, parseJsonObject)) };
  });

app.put("/api/custom-fields/definitions/:fieldId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const params = z.object({ fieldId: z.string().trim().min(1).max(180) }).parse(request.params);
    const body = definitionUpsertSchema.parse(request.body);
    if (body.payload.id !== params.fieldId) throw createHttpError("VALIDATION_FAILED", "Custom field ID does not match the route.", 400);
    const existing = await prisma.clusterPersistenceRecord.findFirst({ where: { kind: "customFieldDefinition", entityId: params.fieldId }, orderBy: { updatedAt: "desc" } });
    if (body.expectedRevision && (!existing || Number(existing.revision || 1) !== body.expectedRevision)) {
      reply.code(409); return { ok: false, code: "REVISION_CONFLICT", error: "This custom field changed on the server.", current: existing ? serialize(existing, parseJsonObject) : null };
    }
    const now = new Date().toISOString();
    const current = existing ? parseJsonObject(existing.payload) : {};
    const payload = { ...current, ...body.payload, id: params.fieldId, createdAt: body.payload.createdAt || current.createdAt || now, updatedAt: now };
    const data = {
      title: payload.label, entityType: payload.entity, entityId: params.fieldId, status: payload.archivedAt ? "archived" : payload.enabled === false ? "disabled" : "active",
      visibility: payload.viewAccess || "everyone", sourceKey: "custom-field-api", ...buildPersistenceStorageData("customFieldDefinition", payload, existing?.id || null),
      payload: jsonPayload(payload), archived: false, deletedAt: null, syncedAt: new Date(),
    };
    const record = existing
      ? await guardedUpdate(reply, existing, body.expectedRevision, data, "This custom field changed on the server.")
      : await prisma.clusterPersistenceRecord.create({ data: { id: recordId("customFieldDefinition", params.fieldId), kind: "customFieldDefinition", ...data, revision: 1 } });
    if (!record) return;
    await logPersistenceAudit({ recordId: record.id, kind: "customFieldDefinition", action: existing ? "custom_field_definition_updated" : "custom_field_definition_created", actorId: admin.id || null, summary: `${existing ? "Updated" : "Created"} custom field: ${payload.label}`, metadata: { fieldId: params.fieldId, revision: record.revision } });
    return serialize(record, parseJsonObject);
  });

  app.delete("/api/custom-fields/definitions/:fieldId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const params = z.object({ fieldId: z.string().trim().min(1).max(180) }).parse(request.params);
    const query = z.object({ purge: z.coerce.boolean().optional(), expectedRevision: z.coerce.number().int().positive().optional() }).parse(request.query || {});
    const existing = await prisma.clusterPersistenceRecord.findFirst({ where: { kind: "customFieldDefinition", entityId: params.fieldId }, orderBy: { updatedAt: "desc" } });
    if (!existing) return { ok: true, removed: false };
    if (query.expectedRevision && Number(existing.revision || 1) !== query.expectedRevision) { reply.code(409); return { ok: false, code: "REVISION_CONFLICT", error: "This custom field changed on the server.", current: serialize(existing, parseJsonObject) }; }
    if (query.purge) {
      const expected = query.expectedRevision || Number(existing.revision || 1);
      try {
        const deletedValues = await prisma.$transaction(async (tx: any) => {
          const deletedDefinition = await tx.clusterPersistenceRecord.deleteMany({ where: { id: existing.id, revision: expected } });
          if (deletedDefinition.count !== 1) throw createHttpError("REVISION_CONFLICT", "This custom field changed on the server.", 409);
          const result = await tx.clusterPersistenceRecord.deleteMany({ where: { kind: "customFieldValue", status: params.fieldId } });
          return result.count;
        });
        await logPersistenceAudit({ recordId: existing.id, kind: "customFieldDefinition", action: "custom_field_definition_purged", actorId: admin.id || null, summary: `Purged custom field ${existing.title} and ${deletedValues} value(s).`, metadata: { fieldId: params.fieldId } });
        return { ok: true, purged: true, deletedValues };
      } catch (error) {
        if ((error as { code?: string })?.code !== "REVISION_CONFLICT") throw error;
        const current = await prisma.clusterPersistenceRecord.findUnique({ where: { id: existing.id } });
        reply.code(409); return { ok: false, code: "REVISION_CONFLICT", error: "This custom field changed on the server.", current: current ? serialize(current, parseJsonObject) : null };
      }
    }
    const payload = { ...parseJsonObject(existing.payload), enabled: false, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const record = await guardedUpdate(reply, existing, query.expectedRevision, { status: "archived", payload: jsonPayload(payload), syncedAt: new Date() }, "This custom field changed on the server.");
    return record ? serialize(record, parseJsonObject) : undefined;
  });

  app.get("/api/custom-fields/usage/:fieldId", async (request, reply) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    const params = z.object({ fieldId: z.string().trim().min(1).max(180) }).parse(request.params);
    return { fieldId: params.fieldId, count: await prisma.clusterPersistenceRecord.count({ where: { kind: "customFieldValue", status: params.fieldId, archived: false } }) };
  });

  app.get("/api/custom-fields/values", async (request, reply) => {
    const query = z.object({ entity: z.enum(CLUSTER_CUSTOM_FIELD_ENTITIES), entityId: z.string().trim().min(1).max(180), projectId: z.string().trim().max(180).optional() }).parse(request.query);
    const definitions = await prisma.clusterPersistenceRecord.findMany({ where: { kind: "customFieldDefinition", entityType: query.entity, archived: false } });
    const rank = await requestAccessRank(request, query.entity, query.entityId, query.projectId);
    if (rank < 0) { reply.code(403); return { ok: false, code: "PERMISSION_DENIED", error: "Custom field view access required." }; }
    const activeDefinitions = definitions.map((definition: any) => ({ definition, payload: parseJsonObject(definition.payload) }))
      .filter(({ payload }: any) => payload.enabled !== false && !payload.archivedAt);
    const visibleFieldIds = activeDefinitions
      .filter(({ payload }: any) => rank >= fieldAccessRank(payload.viewAccess || "everyone"))
      .map(({ definition }: any) => String(definition.entityId));
    const visible = new Set(visibleFieldIds);
    const editableFieldIds = activeDefinitions
      .filter(({ payload }: any) => rank >= fieldAccessRank(strictestFieldAccess(payload.viewAccess, payload.editAccess)))
      .map(({ definition }: any) => String(definition.entityId));
    const records = await prisma.clusterPersistenceRecord.findMany({ where: { kind: "customFieldValue", entityType: query.entity, entityId: query.entityId, archived: false }, orderBy: { updatedAt: "desc" }, take: 500 });
    return {
      records: records.filter((record: any) => visible.has(String(record.status || ""))).map((record: any) => serialize(record, parseJsonObject)),
      visibleFieldIds,
      editableFieldIds,
    };
  });

  app.post("/api/custom-fields/values/query", async (request, reply) => {
    const body = valueQuerySchema.parse(request.body);
    const current = await getCurrentUser(request);
    const decorated = current ? await decorateUserForClient(current) : null;
    if (!current) { reply.code(401); return { ok: false, code: "AUTH_REQUIRED", error: "Sign in to view custom fields." }; }
    const definitions = await prisma.clusterPersistenceRecord.findMany({ where: { kind: "customFieldDefinition", entityType: body.entity, archived: false } });
    const definitionRanks = new Map<string, ReturnType<typeof minimumFor>>(
      definitions.flatMap((definition: any) => {
        const payload = parseJsonObject(definition.payload);
        if (payload.enabled === false || payload.archivedAt) return [];
        return [[String(definition.entityId), minimumFor(payload.viewAccess as CustomFieldAccess | undefined, "view")]];
      }),
    );
    const accessRank = (level: string) => level === "admin" ? 3 : level === "manage" ? 2 : level === "contribute" ? 1 : 0;
    const rankByEntityId = new Map<string, number>();
    for (const entry of body.entries) {
      if (decorated?.isAdmin) { rankByEntityId.set(entry.entityId, 3); continue; }
      const entryProjectId = typeof entry.projectId === "string" ? entry.projectId : undefined;
      // Resolve the entity first. A client-supplied projectId is only a consistency
      // hint and must never grant access to an entity that belongs to another project.
      rankByEntityId.set(entry.entityId, await requestAccessRank(request, body.entity, entry.entityId, entryProjectId));
    }
    const entityIds: string[] = Array.from(new Set(body.entries.map((entry) => String(entry.entityId))));
    const records = await prisma.clusterPersistenceRecord.findMany({ where: { kind: "customFieldValue", entityType: body.entity, entityId: { in: entityIds }, archived: false }, orderBy: { updatedAt: "desc" }, take: 5000 });
    const visible = records.filter((record: any) => {
      const rank = rankByEntityId.get(String(record.entityId)) ?? -1;
      const minimum = definitionRanks.get(String(record.status || ""));
      return rank >= 0 && minimum !== undefined && rank >= accessRank(minimum);
    });
    return { records: visible.map((record: any) => serialize(record, parseJsonObject)), deniedEntityIds: entityIds.filter((entityId) => (rankByEntityId.get(entityId) ?? -1) < 0) };
  });

app.put("/api/custom-fields/values/:entity/:entityId/:fieldId", async (request, reply) => {
    const params = valueParamsSchema.parse(request.params);
    const body = valueUpsertSchema.parse(request.body);
    if (body.payload.entity !== params.entity || body.payload.entityId !== params.entityId || body.payload.fieldId !== params.fieldId) throw createHttpError("VALIDATION_FAILED", "Custom field value identity does not match the route.", 400);
    const context = await requireValueAccess(request, reply, params.entity, params.entityId, body.payload.projectId, params.fieldId, "edit");
    if (!context) return;
    const actor = await getCurrentUser(request);
    const id = recordId("customFieldValue", `${params.entity}:${params.entityId}:${params.fieldId}`);
    const existing = await prisma.clusterPersistenceRecord.findUnique({ where: { id } });
    if (body.expectedRevision && (!existing || Number(existing.revision || 1) !== body.expectedRevision)) { reply.code(409); return { ok: false, code: "REVISION_CONFLICT", error: "This custom field value changed on the server.", current: existing ? serialize(existing, parseJsonObject) : null }; }
    const canonicalProjectId = context.project?.id || null;
    const payload = { ...body.payload, projectId: canonicalProjectId, id: `${params.entity}:${params.entityId}:${params.fieldId}`, updatedAt: new Date().toISOString(), updatedBy: body.payload.updatedBy || actor?.id || undefined };
    const data = {
      title: `${params.entity}:${params.entityId}:${params.fieldId}`, projectId: canonicalProjectId, entityType: params.entity, entityId: params.entityId, status: params.fieldId,
      visibility: "internal", sourceKey: "custom-field-api", ...buildPersistenceStorageData("customFieldValue", payload, existing?.id || null), payload: jsonPayload(payload), archived: false, deletedAt: null, syncedAt: new Date(),
    };
    const record = existing
      ? await guardedUpdate(reply, existing, body.expectedRevision, data, "This custom field value changed on the server.")
      : await prisma.clusterPersistenceRecord.create({ data: { id, kind: "customFieldValue", ...data, revision: 1 } });
    if (!record) return;
    await logActivity({ userId: actor?.id, projectId: payload.projectId || null, type: existing ? "updated" : "created", entityType: "custom_field_value", entityId: payload.id, title: "Custom field updated", message: params.fieldId, metadata: { fieldId: params.fieldId, fieldLabel: params.fieldId, value: payload.value, targetEntityType: params.entity, targetEntityId: params.entityId, entityLabel: params.entityId, projectId: payload.projectId || null } });
    return serialize(record, parseJsonObject);
  });
}
