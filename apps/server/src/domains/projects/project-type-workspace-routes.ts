import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveClusterProjectType, type ClusterProjectTypeDefinition, type ClusterProjectWorkspaceEntityDefinition } from "@cluster/shared";
import { createHttpError } from "../../core/http-errors.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { serializeProjectControlRecord } from "./project-control-service.js";

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  readSettings: () => Promise<Record<string, any>>;
};

type TypeRecordSeed = { entityKind: string; title: string; status?: string; stage?: string; description?: string; priority?: string; payload?: Record<string, unknown> };

const recordBodySchema = z.object({
  entityKind: z.string().trim().min(1).max(48),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(8000).optional().nullable(),
  status: z.string().trim().min(1).max(48).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
  ownerId: z.string().trim().max(160).optional().nullable(),
  parentId: z.string().trim().max(160).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  progress: z.number().int().min(0).max(100).optional().default(0),
  stage: z.string().trim().max(48).optional().nullable(),
  payload: z.record(z.unknown()).optional().default({}),
});
const patchBodySchema = recordBodySchema.omit({ entityKind: true, title: true }).partial().extend({ title: z.string().trim().min(1).max(240).optional(), expectedRevision: z.number().int().positive().optional() });

function parsePayload(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

function safePayload(value: Record<string, unknown>) {
  const json = JSON.stringify(value || {});
  if (json.length > 32_000) throw createHttpError("VALIDATION_FAILED", "Specialized project metadata is too large.", 400);
  return json;
}

function categoryFor(typeId: string, entityKind: string) { return `type-workspace:${typeId}:${entityKind}`; }
function isTypeWorkspaceCategory(value: unknown) { return String(value || "").startsWith("type-workspace:"); }
function isClosedStatus(value: unknown) { return ["done", "complete", "completed", "resolved", "approved", "released", "delivered", "retired", "rejected"].includes(String(value || "").toLowerCase()); }

async function loadProjectType(prisma: any, readSettings: Dependencies["readSettings"], projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  const settings = await readSettings();
  const definition = resolveClusterProjectType(project.projectType || "general", settings.projectTypePresets);
  return { project, definition, settings };
}

function entityDefinition(definition: ClusterProjectTypeDefinition, entityKind: string) {
  const entity = (definition.workspaceEntities || []).find((item) => item.id === entityKind);
  if (!entity) throw createHttpError("PROJECT_TYPE_ENTITY_UNSUPPORTED", `${definition.label} does not define a ${entityKind.replaceAll("_", " ")} workspace record.`, 400);
  return entity;
}

async function validateOwner(prisma: any, project: any, ownerId?: string | null) {
  if (!ownerId) return;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: ownerId, user: { archived: false } }, select: { userId: true } });
  if (!member) throw createHttpError("VALIDATION_FAILED", "Owner must be an active workspace member.", 400);
}

async function validateParent(prisma: any, projectId: string, parentId?: string | null, ownId?: string | null) {
  if (!parentId) return;
  if (parentId === ownId) throw createHttpError("VALIDATION_FAILED", "A specialized project record cannot be its own parent.", 400);
  const parent = await prisma.projectControlRecord.findFirst({ where: { id: parentId, projectId, archived: false }, select: { id: true, category: true } });
  if (!parent || !isTypeWorkspaceCategory(parent.category)) throw createHttpError("VALIDATION_FAILED", "Parent must be another specialized record in this project.", 400);
}

function serializeTypeRecord(record: any) {
  const payload = parsePayload(record.payload);
  return { ...serializeProjectControlRecord(record), entityKind: String(payload.projectTypeEntityKind || String(record.category || "").split(":").pop() || record.kind), stage: payload.projectTypeStage || null };
}

export function projectTypeTemplateSeeds(definition: ClusterProjectTypeDefinition, template: string): TypeRecordSeed[] {
  const normalized = template.trim().toLowerCase();
  const byCategory: Record<string, Record<string, TypeRecordSeed[]>> = {
    game: {
      "vertical slice": [
        { entityKind: "feature", title: "Core playable feature", status: "ready", stage: "development" },
        { entityKind: "system", title: "Core gameplay systems", status: "design", stage: "development" },
        { entityKind: "level", title: "Vertical slice level", status: "blockout", stage: "development" },
        { entityKind: "playtest", title: "Vertical slice playtest", status: "planned", stage: "playtest" },
        { entityKind: "release", title: "Vertical slice build", status: "planned", stage: "release_candidate" },
      ],
      "content update": [
        { entityKind: "feature", title: "Update feature set", status: "backlog", stage: "development" },
        { entityKind: "asset", title: "Content package", status: "brief", stage: "development" },
        { entityKind: "playtest", title: "Content validation playtest", status: "planned", stage: "playtest" },
        { entityKind: "release", title: "Content update", status: "planned", stage: "release" },
      ],
      "release candidate": [
        { entityKind: "platform", title: "Primary launch platform", status: "planned", stage: "release_candidate" },
        { entityKind: "playtest", title: "Release candidate validation", status: "planned", stage: "qa" },
        { entityKind: "release", title: "Release candidate", status: "planned", stage: "release_candidate" },
      ],
    },
    software: {
      "feature release": [
        { entityKind: "release", title: "Feature release", status: "planned", stage: "production" },
        { entityKind: "environment", title: "Staging", status: "healthy", stage: "staging" },
        { entityKind: "deployment", title: "Staging deployment", status: "planned", stage: "staging" },
        { entityKind: "deployment", title: "Production deployment", status: "planned", stage: "production" },
      ],
      hotfix: [
        { entityKind: "incident", title: "Production regression", status: "investigating", stage: "production", priority: "urgent" },
        { entityKind: "change_request", title: "Emergency hotfix", status: "draft", stage: "review", priority: "high" },
        { entityKind: "deployment", title: "Hotfix deployment", status: "planned", stage: "production", priority: "high" },
      ],
      "infrastructure change": [
        { entityKind: "change_request", title: "Infrastructure change", status: "draft", stage: "review" },
        { entityKind: "environment", title: "Target environment", status: "planned", stage: "staging" },
        { entityKind: "deployment", title: "Infrastructure rollout", status: "planned", stage: "production" },
      ],
    },
    creative: {
      "brand asset": [
        { entityKind: "concept", title: "Creative direction", status: "brief", stage: "concept" },
        { entityKind: "asset", title: "Primary brand asset", status: "brief", stage: "production" },
        { entityKind: "review_round", title: "Stakeholder review", status: "planned", stage: "review" },
        { entityKind: "approval", title: "Final approval", status: "pending", stage: "approved" },
        { entityKind: "deliverable", title: "Final asset package", status: "planned", stage: "delivered" },
      ],
      "campaign creative": [
        { entityKind: "concept", title: "Campaign concept", status: "brief", stage: "concept" },
        { entityKind: "asset", title: "Campaign master", status: "brief", stage: "production" },
        { entityKind: "iteration", title: "Internal iteration", status: "working", stage: "review" },
        { entityKind: "review_round", title: "Client review", status: "planned", stage: "review" },
        { entityKind: "deliverable", title: "Campaign delivery", status: "planned", stage: "delivered" },
      ],
      "design review": [
        { entityKind: "iteration", title: "Review candidate", status: "working", stage: "review" },
        { entityKind: "review_round", title: "Design review", status: "planned", stage: "review" },
        { entityKind: "approval", title: "Design approval", status: "pending", stage: "approved" },
      ],
    },
    marketing: {
      "campaign launch": [
        { entityKind: "campaign", title: "Campaign launch", status: "planning", stage: "planning" },
        { entityKind: "audience", title: "Primary audience", status: "draft", stage: "planning" },
        { entityKind: "deliverable", title: "Campaign master", status: "brief", stage: "production" },
        { entityKind: "channel", title: "Primary channel", status: "planned", stage: "scheduled" },
        { entityKind: "activation", title: "Launch activation", status: "planned", stage: "live" },
        { entityKind: "performance_report", title: "Launch performance report", status: "planned", stage: "complete" },
      ],
      "content campaign": [
        { entityKind: "campaign", title: "Content campaign", status: "planning", stage: "planning" },
        { entityKind: "deliverable", title: "Hero content", status: "brief", stage: "production" },
        { entityKind: "channel", title: "Content distribution", status: "planned", stage: "scheduled" },
        { entityKind: "activation", title: "Publishing window", status: "planned", stage: "live" },
      ],
      "product announcement": [
        { entityKind: "campaign", title: "Product announcement", status: "planning", stage: "planning" },
        { entityKind: "audience", title: "Announcement audience", status: "draft", stage: "planning" },
        { entityKind: "deliverable", title: "Announcement package", status: "brief", stage: "production" },
        { entityKind: "activation", title: "Announcement launch", status: "planned", stage: "live" },
      ],
    },
    event: {
      "live event": [
        { entityKind: "event", title: "Live event", status: "planning", stage: "planning" },
        { entityKind: "session", title: "Main program", status: "draft", stage: "preproduction" },
        { entityKind: "resource", title: "Primary venue / stage", status: "requested", stage: "preproduction" },
        { entityKind: "booking", title: "Core crew booking", status: "requested", stage: "preproduction" },
        { entityKind: "run_item", title: "Doors / opening cue", status: "planned", stage: "live" },
      ],
      "recording day": [
        { entityKind: "event", title: "Recording day", status: "planning", stage: "planning" },
        { entityKind: "session", title: "Recording session", status: "draft", stage: "preproduction" },
        { entityKind: "resource", title: "Studio / location", status: "requested", stage: "preproduction" },
        { entityKind: "booking", title: "Production crew", status: "requested", stage: "preproduction" },
      ],
      "conference session": [
        { entityKind: "session", title: "Conference session", status: "draft", stage: "preproduction" },
        { entityKind: "booking", title: "Speaker / talent booking", status: "requested", stage: "preproduction" },
        { entityKind: "run_item", title: "Session run of show", status: "planned", stage: "live" },
      ],
    },
    operations: {
      "operational initiative": [
        { entityKind: "initiative", title: "Operational initiative", status: "intake", stage: "intake" },
        { entityKind: "procedure", title: "Operating procedure", status: "draft", stage: "review" },
        { entityKind: "improvement", title: "Process improvement", status: "proposed", stage: "review" },
      ],
      "recurring service": [
        { entityKind: "service_request", title: "Service intake", status: "intake", stage: "intake" },
        { entityKind: "procedure", title: "Service runbook", status: "draft", stage: "review" },
        { entityKind: "recurring_run", title: "Recurring service run", status: "planned", stage: "active" },
      ],
      "process improvement": [
        { entityKind: "improvement", title: "Process improvement", status: "proposed", stage: "review" },
        { entityKind: "procedure", title: "Updated procedure", status: "draft", stage: "review" },
        { entityKind: "initiative", title: "Improvement rollout", status: "planned", stage: "active" },
      ],
    },
  };
  const category = String(definition.category || "general");
  const exact = byCategory[category]?.[normalized];
  if (exact) return exact.filter((seed) => (definition.workspaceEntities || []).some((entity) => entity.id === seed.entityKind));
  return (definition.workspaceEntities || []).slice(0, 5).map((entity) => ({ entityKind: entity.id, title: `${template} · ${entity.label}`, status: entity.defaultStatus, stage: entity.stage }));
}

export function registerProjectTypeWorkspaceRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity, readSettings }: Dependencies) {
  app.get("/api/projects/:projectId/type-workspace", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const { project, definition } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const records = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: "type-workspace:" } }, orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { updatedAt: "desc" }], take: 1000 });
    const items = records.map(serializeTypeRecord);
    const supported = new Set((definition.workspaceEntities || []).map((entity) => entity.id));
    const stages = definition.deliveryStages || [];
    return {
      projectId: project.id,
      type: definition,
      records: items,
      summary: {
        total: items.length,
        open: items.filter((record: any) => !isClosedStatus(record.status)).length,
        complete: items.filter((record: any) => isClosedStatus(record.status)).length,
        unsupported: items.filter((record: any) => !supported.has(String(record.entityKind))).length,
        unowned: items.filter((record: any) => !record.ownerId && !isClosedStatus(record.status)).length,
        stages: stages.map((stage) => ({ stage, count: items.filter((record: any) => String(record.stage || "") === stage).length, owners: definition.stageOwnership?.[stage] || [] })),
      },
    };
  });

  app.post("/api/projects/:projectId/type-workspace/records", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = recordBodySchema.parse(request.body);
    const { project, definition } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const entity = entityDefinition(definition, body.entityKind);
    await Promise.all([validateOwner(prisma, project, body.ownerId), validateParent(prisma, project.id, body.parentId)]);
    const status = body.status || entity.defaultStatus;
    if (!entity.statuses.includes(status)) throw createHttpError("VALIDATION_FAILED", `${entity.label} status is not valid for this project type.`, 400);
    const stage = String(body.stage || entity.stage || "").trim() || null;
    if (stage && definition.deliveryStages?.length && !definition.deliveryStages.includes(stage)) throw createHttpError("VALIDATION_FAILED", "Selected stage is not part of this project type.", 400);
    if (body.startDate && body.dueDate && body.dueDate.getTime() < body.startDate.getTime()) throw createHttpError("VALIDATION_FAILED", "Due date must be on or after the start date.", 400);
    const payload = { ...(body.payload || {}), projectTypeId: definition.id, projectTypeEntityKind: entity.id, projectTypeEntityLabel: entity.label, projectTypeStage: stage };
    const record = await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: entity.baseKind, title: body.title, description: body.description || null, status, priority: body.priority, ownerId: body.ownerId || null, parentId: body.parentId || null, category: categoryFor(definition.id, entity.id), startDate: body.startDate || null, dueDate: body.dueDate || null, completedAt: isClosedStatus(status) ? new Date() : null, progress: isClosedStatus(status) ? 100 : body.progress, sortOrder: 0, payload: safePayload(payload) } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: `project_${entity.baseKind}`, entityId: record.id, title: `${entity.label} created`, message: record.title, metadata: { projectTypeId: definition.id, projectTypeEntityKind: entity.id, projectTypeStage: stage } });
    return serializeTypeRecord(record);
  });

  app.patch("/api/projects/:projectId/type-workspace/records/:recordId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const body = patchBodySchema.parse(request.body);
    const { project, definition } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const existing = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: project.id, archived: false, category: { startsWith: "type-workspace:" } } });
    if (!existing) throw createHttpError("PROJECT_TYPE_RECORD_NOT_FOUND", "Specialized project record not found.", 404);
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) return reply.code(409).send({ code: "REVISION_CONFLICT", message: "This record changed on the server. Refresh and retry.", current: serializeTypeRecord(existing) });
    const currentPayload = parsePayload(existing.payload);
    const entity = entityDefinition(definition, String(currentPayload.projectTypeEntityKind || String(existing.category || "").split(":").pop()));
    await Promise.all([validateOwner(prisma, project, body.ownerId), validateParent(prisma, project.id, body.parentId, existing.id)]);
    const status = body.status === undefined ? existing.status : body.status;
    if (status && !entity.statuses.includes(status)) throw createHttpError("VALIDATION_FAILED", `${entity.label} status is not valid for this project type.`, 400);
    const stage = body.stage === undefined ? currentPayload.projectTypeStage || entity.stage || null : body.stage || null;
    if (stage && definition.deliveryStages?.length && !definition.deliveryStages.includes(stage)) throw createHttpError("VALIDATION_FAILED", "Selected stage is not part of this project type.", 400);
    const effectiveStart = body.startDate === undefined ? existing.startDate : body.startDate;
    const effectiveDue = body.dueDate === undefined ? existing.dueDate : body.dueDate;
    if (effectiveStart && effectiveDue && new Date(effectiveDue).getTime() < new Date(effectiveStart).getTime()) throw createHttpError("VALIDATION_FAILED", "Due date must be on or after the start date.", 400);
    const payload = body.payload === undefined ? { ...currentPayload, projectTypeId: definition.id, projectTypeEntityKind: entity.id, projectTypeEntityLabel: entity.label, projectTypeStage: stage } : { ...currentPayload, ...body.payload, projectTypeId: definition.id, projectTypeEntityKind: entity.id, projectTypeEntityLabel: entity.label, projectTypeStage: stage };
    const record = await prisma.projectControlRecord.update({ where: { id: existing.id }, data: { title: body.title, description: body.description === undefined ? undefined : body.description || null, status: body.status, priority: body.priority, ownerId: body.ownerId === undefined ? undefined : body.ownerId || null, parentId: body.parentId === undefined ? undefined : body.parentId || null, startDate: body.startDate, dueDate: body.dueDate, completedAt: body.status === undefined ? undefined : isClosedStatus(body.status) ? new Date() : null, progress: body.status && isClosedStatus(body.status) ? 100 : body.progress, payload: safePayload(payload), revision: { increment: 1 } } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: `project_${entity.baseKind}`, entityId: record.id, title: `${entity.label} updated`, message: record.title, metadata: { projectTypeId: definition.id, projectTypeEntityKind: entity.id, projectTypeStage: stage } });
    return serializeTypeRecord(record);
  });

  app.post("/api/projects/:projectId/type-workspace/apply-template", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ template: z.string().trim().min(1).max(120) }).parse(request.body);
    const { project, definition } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    if (!(definition.productionTemplates || []).some((template) => template.toLowerCase() === body.template.toLowerCase())) throw createHttpError("PROJECT_TYPE_TEMPLATE_INVALID", "That production template is not available for this project type.", 400);
    const seeds = projectTypeTemplateSeeds(definition, body.template).slice(0, 20);
    const existing = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: `type-workspace:${definition.id}:` } }, select: { title: true, category: true } });
    const existingKeys = new Set(existing.map((record: any) => `${record.category}:${String(record.title).toLowerCase()}`));
    const created: any[] = [];
    for (const [index, seed] of seeds.entries()) {
      const entity = entityDefinition(definition, seed.entityKind);
      const key = `${categoryFor(definition.id, entity.id)}:${seed.title.toLowerCase()}`;
      if (existingKeys.has(key)) continue;
      const status = seed.status && entity.statuses.includes(seed.status) ? seed.status : entity.defaultStatus;
      const stage = seed.stage && definition.deliveryStages?.includes(seed.stage) ? seed.stage : entity.stage || null;
      const record = await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: entity.baseKind, title: seed.title, description: seed.description || null, status, priority: seed.priority || "medium", category: categoryFor(definition.id, entity.id), completedAt: isClosedStatus(status) ? new Date() : null, progress: isClosedStatus(status) ? 100 : 0, sortOrder: index * 100, payload: safePayload({ ...(seed.payload || {}), projectTypeId: definition.id, projectTypeEntityKind: entity.id, projectTypeEntityLabel: entity.label, projectTypeStage: stage, projectTypeTemplate: body.template }) } });
      created.push(serializeTypeRecord(record));
    }
    await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: "project_type_template", entityId: project.id, title: `${definition.label} template applied`, message: `${body.template} · ${created.length} records`, metadata: { projectTypeId: definition.id, template: body.template, created: created.length } });
    return { ok: true, created, skipped: seeds.length - created.length };
  });

  app.post("/api/projects/:projectId/type-workspace/stage-automation", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ stage: z.string().trim().min(1).max(48), ownerId: z.string().trim().max(160).optional().nullable() }).parse(request.body);
    const { project, definition } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    if (!(definition.deliveryStages || []).includes(body.stage)) throw createHttpError("VALIDATION_FAILED", "Stage is not part of this project type.", 400);
    await validateOwner(prisma, project, body.ownerId);
    const sourceKey = `type-stage:${definition.id}:${body.stage}`;
    const existing = await prisma.projectControlRecord.findFirst({ where: { projectId: project.id, kind: "automation", category: sourceKey, archived: false } });
    const ownership = definition.stageOwnership?.[body.stage] || [];
    const payload = { trigger: "record_completed", enabled: true, conditions: [{ field: "source.payload.projectTypeStage", operator: "equals", value: body.stage }], actions: [{ type: "notify", title: `${definition.label}: ${body.stage.replaceAll("_", " ")} handoff ready`, message: `A ${body.stage.replaceAll("_", " ")} record completed and is ready for the next production handoff.`, ownerId: body.ownerId || null, priority: "medium" }], retryPolicy: { maxAttempts: 3, backoffMinutes: 5, pauseAfterFailures: 3 }, notifyOnFailure: true, projectTypeStage: body.stage, expectedOwners: ownership };
    const record = existing ? await prisma.projectControlRecord.update({ where: { id: existing.id }, data: { ownerId: body.ownerId || null, status: "active", payload: safePayload(payload), revision: { increment: 1 } } }) : await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: "automation", title: `${definition.label} · ${body.stage.replaceAll("_", " ")} handoff`, status: "active", priority: "medium", ownerId: body.ownerId || null, category: sourceKey, payload: safePayload(payload) } });
    await logActivity({ userId: user?.id, projectId: project.id, type: existing ? "updated" : "created", entityType: "project_automation", entityId: record.id, title: "Project type stage automation configured", message: body.stage.replaceAll("_", " "), metadata: { projectTypeId: definition.id, stage: body.stage } });
    return serializeProjectControlRecord(record);
  });

  app.get("/api/projects/:projectId/type-workspace/migration-preview", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ targetType: z.string().trim().min(1).max(64) }).parse(request.query);
    const { project, definition: current, settings } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const target = resolveClusterProjectType(query.targetType, settings.projectTypePresets);
    const records = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: "type-workspace:" } }, select: { id: true, title: true, category: true, payload: true } });
    const targetEntities = new Set((target.workspaceEntities || []).map((entity) => entity.id));
    const affected = records.map((record: any) => ({ id: record.id, title: record.title, entityKind: String(parsePayload(record.payload).projectTypeEntityKind || String(record.category || "").split(":").pop()) })).filter((record: any) => !targetEntities.has(record.entityKind));
    const currentTools = new Set([...(current.defaultTools || []), ...(current.optionalTools || [])]);
    const targetTools = new Set([...(target.defaultTools || []), ...(target.optionalTools || [])]);
    const removedTools = [...currentTools].filter((tool) => !targetTools.has(tool));
    const addedTools = [...targetTools].filter((tool) => !currentTools.has(tool));
    const droppedStages = (current.deliveryStages || []).filter((stage) => !(target.deliveryStages || []).includes(stage));
    const warnings = [affected.length ? `${affected.length} specialized record${affected.length === 1 ? "" : "s"} do not map directly to ${target.label}.` : "", removedTools.length ? `${removedTools.length} project tool${removedTools.length === 1 ? "" : "s"} would leave the default workspace.` : "", droppedStages.length ? `${droppedStages.length} delivery stage${droppedStages.length === 1 ? "" : "s"} would no longer exist.` : ""].filter(Boolean);
    return { projectId: project.id, currentType: current, targetType: target, targetEntities: target.workspaceEntities || [], affectedRecords: affected.slice(0, 100), removedTools, addedTools, droppedStages, warnings, safe: affected.length === 0, requiresConfirmation: warnings.length > 0 };
  });

  app.post("/api/projects/:projectId/type-workspace/migrate", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({
      targetType: z.string().trim().min(1).max(64),
      recordMappings: z.record(z.string().trim().min(1).max(64)).optional().default({}),
      confirmRemovedTools: z.boolean().optional().default(false),
      confirmDroppedStages: z.boolean().optional().default(false),
      expectedRevision: z.number().int().positive().optional(),
    }).parse(request.body);
    const { project, definition: current, settings } = await loadProjectType(prisma, readSettings, params.projectId);
    if (!user?.isAdmin) throw createHttpError("PROJECT_TYPE_ADMIN_REQUIRED", "Admin role required to change the project type.", 403);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== project.revision) return reply.code(409).send({ code: "REVISION_CONFLICT", message: "This project changed on the server. Refresh and preview the migration again." });
    const target = resolveClusterProjectType(body.targetType, settings.projectTypePresets);
    if (!target || target.enabled === false) throw createHttpError("PROJECT_TYPE_INVALID", "Target project type is unavailable.", 400);
    if (target.id === current.id) return { ok: true, unchanged: true, projectId: project.id, projectType: current.id, migrated: 0, archived: 0 };
    const records = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: "type-workspace:" } }, orderBy: { sortOrder: "asc" } });
    const targetEntities = new Map((target.workspaceEntities || []).map((entity) => [entity.id, entity]));
    const currentTools = new Set([...(current.defaultTools || []), ...(current.optionalTools || [])]);
    const targetTools = new Set([...(target.defaultTools || []), ...(target.optionalTools || [])]);
    const removedTools = [...currentTools].filter((tool) => !targetTools.has(tool));
    const droppedStages = (current.deliveryStages || []).filter((stage) => !(target.deliveryStages || []).includes(stage));
    if (removedTools.length && !body.confirmRemovedTools) throw createHttpError("PROJECT_TYPE_TOOL_CONFIRMATION_REQUIRED", "Confirm the project tools that will leave the default workspace before applying this migration.", 409);
    if (droppedStages.length && !body.confirmDroppedStages) throw createHttpError("PROJECT_TYPE_STAGE_CONFIRMATION_REQUIRED", "Confirm the delivery stages that will be removed before applying this migration.", 409);
    const plans = records.map((record: any) => {
      const payload = parsePayload(record.payload);
      const currentEntityKind = String(payload.projectTypeEntityKind || String(record.category || "").split(":").pop());
      const requested = body.recordMappings[record.id] || (targetEntities.has(currentEntityKind) ? currentEntityKind : "");
      if (!requested) throw createHttpError("PROJECT_TYPE_RECORD_MAPPING_REQUIRED", `Choose how to migrate ${record.title}.`, 409);
      if (requested === "archive") return { record, payload, currentEntityKind, action: "archive" as const, targetEntity: null };
      const targetEntity = targetEntities.get(requested);
      if (!targetEntity) throw createHttpError("PROJECT_TYPE_RECORD_MAPPING_INVALID", `The selected mapping for ${record.title} is not supported by ${target.label}.`, 400);
      return { record, payload, currentEntityKind, action: "map" as const, targetEntity };
    });
    let migrated = 0;
    let archived = 0;
    await prisma.$transaction(async (tx: any) => {
      for (const plan of plans) {
        if (plan.action === "archive") {
          await tx.projectControlRecord.update({ where: { id: plan.record.id }, data: { archived: true, revision: { increment: 1 }, payload: safePayload({ ...plan.payload, projectTypeMigration: { fromType: current.id, toType: target.id, fromEntityKind: plan.currentEntityKind, action: "archived", migratedAt: new Date().toISOString(), migratedById: user.id } }) } });
          archived += 1;
          continue;
        }
        const entity = plan.targetEntity!;
        const status = entity.statuses.includes(String(plan.record.status || "")) ? plan.record.status : entity.defaultStatus;
        const oldStage = String(plan.payload.projectTypeStage || "");
        const stage = oldStage && (target.deliveryStages || []).includes(oldStage) ? oldStage : entity.stage || target.deliveryStages?.[0] || null;
        await tx.projectControlRecord.update({ where: { id: plan.record.id }, data: { kind: entity.baseKind, category: categoryFor(target.id, entity.id), status, completedAt: isClosedStatus(status) ? plan.record.completedAt || new Date() : null, progress: isClosedStatus(status) ? 100 : Math.min(Number(plan.record.progress || 0), 99), payload: safePayload({ ...plan.payload, projectTypeId: target.id, projectTypeEntityKind: entity.id, projectTypeEntityLabel: entity.label, projectTypeStage: stage, projectTypeMigration: { fromType: current.id, toType: target.id, fromEntityKind: plan.currentEntityKind, action: "mapped", migratedAt: new Date().toISOString(), migratedById: user.id } }), revision: { increment: 1 } } });
        migrated += 1;
      }
      await tx.project.update({ where: { id: project.id }, data: { projectType: target.id, productionTracks: JSON.stringify((target.tracks || []).slice(0, 12)), revision: { increment: 1 } } });
    });
    await logActivity({ userId: user.id, projectId: project.id, type: "updated", entityType: "project", entityId: project.id, title: "Project type migrated", message: `${current.label} → ${target.label}`, metadata: { fromType: current.id, toType: target.id, migrated, archived, removedTools, droppedStages } });
    return { ok: true, projectId: project.id, fromType: current.id, projectType: target.id, migrated, archived, removedTools, droppedStages, revision: Number(project.revision || 0) + 1 };
  });
}
