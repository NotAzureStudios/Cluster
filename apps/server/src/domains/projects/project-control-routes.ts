import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { CLUSTER_RESOURCE_GRAPH_CATEGORIES, CLUSTER_WORKFLOW_RELATIONSHIPS, CLUSTER_WORK_SOURCE_KINDS, workflowLinkInputSchema, workflowLinkPatchSchema, type ClusterWorkSource, type ClusterWorkSourceKind } from "@cluster/shared";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { LibraryAccessService } from "../library/library-access-service.js";
import { recordLibraryBacklink } from "../library/library-governance.js";
import { createHttpError } from "../../core/http-errors.js";import { PROJECT_CONTROL_KINDS, buildProjectControlSummary, buildStatusReportDraft, serializeProjectControlRecord, serializeProjectRelationship } from "./project-control-service.js";

import { enrichProjectControlRecords } from "./project-control-link-service.js";
import { createResourceGraphService } from "../work/resource-graph-service.js";
import { buildProjectEvidencePayload, buildProjectWorkflowLinksPayload, hydrateProjectWorkflowSources, cardRelationshipGraphDiagnostic, searchProjectEvidenceCandidates, searchProjectWorkflowCandidates } from "./project-workflow-link-service.js";

type ProjectControlRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  requestCanTarget: (...args: any[]) => Promise<boolean>;
  sendRevisionConflict: (reply: FastifyReply, entityType: string, current: unknown) => unknown;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  projectAutomation: {
    executeRule: (ruleOrId: any, options?: any) => Promise<any>;
    enqueueRuleExecution: (ruleOrId: any, options?: any) => Promise<any>;
  };
  libraryAccess: LibraryAccessService;
};


async function syncWorkflowLibraryBacklinks(prisma: any, relationship: any) {
  const refs = [
    relationship.sourceType === "library" ? { itemId: relationship.sourceId, sourceKind: relationship.targetType, sourceId: relationship.targetId } : null,
    relationship.targetType === "library" ? { itemId: relationship.targetId, sourceKind: relationship.sourceType, sourceId: relationship.sourceId } : null,
  ].filter(Boolean) as Array<{ itemId: string; sourceKind: string; sourceId: string }>;
  for (const ref of refs) {
    await recordLibraryBacklink(prisma, {
      itemId: ref.itemId,
      sourceResourceKind: ref.sourceKind,
      sourceResourceId: ref.sourceId,
      relationKind: "workflow",
      label: relationship.description || relationship.relationship || null,
      metadata: { projectId: relationship.projectId, relationshipId: relationship.id, relationship: relationship.relationship },
    });
  }
}

async function removeWorkflowLibraryBacklinks(prisma: any, relationship: any) {
  const refs = [
    relationship.sourceType === "library" ? { itemId: relationship.sourceId, sourceKind: relationship.targetType, sourceId: relationship.targetId } : null,
    relationship.targetType === "library" ? { itemId: relationship.targetId, sourceKind: relationship.sourceType, sourceId: relationship.sourceId } : null,
  ].filter(Boolean) as Array<{ itemId: string; sourceKind: string; sourceId: string }>;
  for (const ref of refs) {
    await prisma.libraryBacklink.deleteMany({
      where: {
        itemId: ref.itemId,
        sourceResourceKind: ref.sourceKind,
        sourceResourceId: ref.sourceId,
        relationKind: "workflow",
      },
    });
  }
}

const WORK_SOURCE_KIND_SCHEMA_VALUES = [...CLUSTER_WORK_SOURCE_KINDS] as [ClusterWorkSourceKind, ...ClusterWorkSourceKind[]];
const kindSchema = z.enum(PROJECT_CONTROL_KINDS);
const statusSchema = z.string().trim().min(1).max(48);
const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const payloadSchema = z.record(z.unknown()).default({});
const recordBodySchema = z.object({
  kind: kindSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(8000).optional().nullable(),
  status: statusSchema.default("open"),
  priority: prioritySchema.default("medium"),
  ownerId: z.string().trim().max(160).optional().nullable(),
  parentId: z.string().trim().max(160).optional().nullable(),
  category: z.string().trim().max(120).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  progress: z.number().int().min(0).max(100).default(0),
  probability: z.number().int().min(1).max(5).optional().nullable(),
  impact: z.number().int().min(1).max(5).optional().nullable(),
  confidence: z.number().int().min(0).max(100).optional().nullable(),
  linkedEntityType: z.string().trim().max(64).optional().nullable(),
  linkedEntityId: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  payload: payloadSchema.optional(),
});
const patchBodySchema = recordBodySchema.partial().extend({ expectedRevision: z.number().int().positive().optional() });

function safePayload(value: Record<string, unknown> | undefined) {
  const payload = { ...(value || {}) };
  // Phase 9H: watchers and approvals are shared Subscription/Decision authorities, not arbitrary payload fields.
  delete payload.watcherIds;
  delete payload.approvalState;
  const json = JSON.stringify(payload);
  if (json.length > 32_000) throw createHttpError("VALIDATION_FAILED", "Project control metadata is too large.", 400);
  return json;
}

function completedAtForStatus(status: string | undefined) {
  return status && ["done", "completed", "resolved", "approved", "accepted", "closed", "published"].includes(status.toLowerCase()) ? new Date() : null;
}

async function ensureProject(prisma: any, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true, allocationPercent: true } } } });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return project;
}

async function validateOwner(prisma: any, project: any, ownerId?: string | null) {
  if (!ownerId) return;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: ownerId, user: { archived: false } }, select: { userId: true } });
  if (!member) throw createHttpError("VALIDATION_FAILED", "Owner must be an active workspace member.", 400);
}

async function validateParent(prisma: any, projectId: string, parentId?: string | null) {
  if (!parentId) return;
  const parent = await prisma.projectControlRecord.findFirst({ where: { id: parentId, projectId, archived: false }, select: { id: true } });
  if (!parent) throw createHttpError("VALIDATION_FAILED", "Parent record does not belong to this project.", 400);
}

async function validateWorkflowEntity(prisma: any, project: any, source: ClusterWorkSource) {
  if (source.projectId && source.projectId !== project.id) throw createHttpError("VALIDATION_FAILED", "Workflow link entity project does not match the current project.", 400);
  let found: unknown = null;
  if (source.kind === "project") found = source.id === project.id ? project : null;
  else if (source.kind === "board") found = await prisma.board.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "card" || source.kind === "ticket") found = await prisma.card.findFirst({ where: { id: source.id, archived: false, list: { board: { projectId: project.id, archived: false } } }, select: { id: true } });
  else if (source.kind === "whiteboard") found = await prisma.whiteboard.findFirst({ where: { id: source.id, projectId: project.id }, select: { id: true } });
  else if (source.kind === "timeline") found = await prisma.timelineItem.findFirst({ where: { id: source.id, projectId: project.id }, select: { id: true } });
  else if (source.kind === "calendar") found = await prisma.calendarEvent.findFirst({ where: { id: source.id, projectId: project.id }, select: { id: true } });
  else if (source.kind === "scheduler") found = await prisma.scheduleBlock.findFirst({ where: { id: source.id, projectId: project.id }, select: { id: true } });
  else if (source.kind === "library") found = await prisma.libraryItem.findFirst({ where: { id: source.id, status: { not: "archived" }, OR: [{ projectId: project.id }, { projectId: null }] }, select: { id: true } });
  else if (source.kind === "file") found = await prisma.projectFile.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "review_asset") found = await prisma.reviewAsset.findFirst({ where: { id: source.id, projectId: project.id, status: { not: "archived" } }, select: { id: true } });
  else if (source.kind === "control") found = await prisma.projectControlRecord.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "user") found = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: source.id, user: { archived: false } }, select: { userId: true } });
  else if (source.kind === "build") found = await prisma.deliveryBuild.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "qa_plan") found = await prisma.deliveryQaPlan.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "qa_session") found = await prisma.deliveryQaSession.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "release") found = await prisma.deliveryRelease.findFirst({ where: { id: source.id, projectId: project.id, archived: false }, select: { id: true } });
  else if (source.kind === "meeting") found = await prisma.clusterPersistenceRecord.findFirst({ where: { projectId: project.id, kind: "meeting", entityId: source.id, archived: false }, select: { id: true } });
  if (!found) throw createHttpError("VALIDATION_FAILED", `${source.kind.replaceAll("_", " ")} does not belong to this project.`, 400);
}

function workflowAccessKinds(source: ClusterWorkSource) {
  return source.kind === "ticket" ? ["card", "ticket"] : [source.kind];
}

async function canWorkflowEntity(deps: ProjectControlRouteDependencies, request: FastifyRequest, project: any, source: ClusterWorkSource, min: "view" | "contribute" | "manage") {
  if (source.kind === "library") return deps.libraryAccess.canAccessItemId(request, source.id, min, { projectId: project.id, includeGlobal: true });
  const accessProject = source.kind === "project" && source.id !== project.id
    ? await deps.prisma.project.findUnique({ where: { id: source.id } })
    : project;
  if (!accessProject || accessProject.archived) return false;
  for (const targetKind of workflowAccessKinds(source)) {
    if (!(await deps.requestCanTarget(request, targetKind, source.id, accessProject, min))) return false;
  }
  return true;
}

async function canReadExistingWorkflowEntity(deps: ProjectControlRouteDependencies, request: FastifyRequest, project: any, source: ClusterWorkSource) {
  // Relationship rows can outlive their endpoint when a resource is archived,
  // moved or deleted. ACL access by itself must not expose a ghost endpoint.
  // Only a normal missing/wrong-project validation result is filtered; actual
  // database failures propagate and cannot silently turn into empty evidence.
  try {
    await validateWorkflowEntity(deps.prisma, project, source);
  } catch (error) {
    if ((error as any)?.code === "VALIDATION_FAILED" && (error as any)?.statusCode === 400) return false;
    throw error;
  }
  return canWorkflowEntity(deps, request, project, source, "view");
}

async function requireWorkflowEntity(deps: ProjectControlRouteDependencies, request: FastifyRequest, reply: FastifyReply, project: any, source: ClusterWorkSource, min: "view" | "contribute" | "manage") {
  if (await canWorkflowEntity(deps, request, project, source, min)) return true;
  reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: `${source.kind.replaceAll("_", " ")} ${min} access required.` });
  return false;
}

async function visibleWorkflowRelationships(deps: ProjectControlRouteDependencies, request: FastifyRequest, project: any, relationships: any[]) {
  // One evidence response often references the same source or owner dozens of
  // times. Check each endpoint once per request, never cache an ACL decision
  // across requests where permissions may have changed.
  const visibility = new Map<string, Promise<boolean>>();
  const canRead = (source: ClusterWorkSource) => {
    const key = `${source.kind}:${source.id}`;
    let check = visibility.get(key);
    if (!check) {
      check = canReadExistingWorkflowEntity(deps, request, project, source);
      visibility.set(key, check);
    }
    return check;
  };
  // Keep both graph metadata and ACL evaluation bounded. A Project can contain
  // thousands of relationships; spawning one promise per row is not acceptable.
  const visibleRows: any[] = [];
  for (let offset = 0; offset < relationships.length; offset += 12) {
    const batch = relationships.slice(offset, offset + 12);
    const checks = await Promise.all(batch.map(async (relationship) => {
      const source = { kind: relationship.sourceType, id: relationship.sourceId, projectId: project.id } as ClusterWorkSource;
      const target = { kind: relationship.targetType, id: relationship.targetId, projectId: project.id } as ClusterWorkSource;
      const [sourceAllowed, targetAllowed] = await Promise.all([canRead(source), canRead(target)]);
      return sourceAllowed && targetAllowed;
    }));
    for (let index = 0; index < batch.length; index += 1) if (checks[index]) visibleRows.push(batch[index]);
  }
  return visibleRows;
}

function templateRecords(template: "game-production" | "software" | "content" | "client-delivery", project: any, ownerId: string | null) {
  const now = Date.now();
  const start = project.startDate ? new Date(project.startDate) : new Date();
  const target = project.targetDate ? new Date(project.targetDate) : new Date(now + 90 * 86_400_000);
  const span = Math.max(28, Math.round((target.getTime() - start.getTime()) / 86_400_000));
  const at = (ratio: number) => new Date(start.getTime() + span * ratio * 86_400_000);
  const phaseNames = template === "game-production"
    ? ["Discovery", "Pre-production", "Production", "Release"]
    : template === "software"
      ? ["Discovery", "Design", "Implementation", "Release"]
      : template === "content"
        ? ["Brief", "Production", "Review", "Publish"]
        : ["Kickoff", "Production", "Client review", "Delivery"];
  const milestoneNames = template === "game-production"
    ? ["Vertical slice", "Alpha", "Beta", "Release candidate"]
    : template === "software"
      ? ["Architecture approved", "Feature complete", "QA complete", "Production ready"]
      : template === "content"
        ? ["Concept approved", "First cut", "Final review", "Published"]
        : ["Scope approved", "Internal review", "Client approval", "Final handoff"];
  const deliverableNames = template === "game-production"
    ? ["Design brief", "Playable build", "QA sign-off", "Release package"]
    : template === "software"
      ? ["Technical brief", "Working implementation", "Test report", "Release package"]
      : template === "content"
        ? ["Creative brief", "Production draft", "Approval package", "Published assets"]
        : ["Delivery brief", "Working draft", "Approval package", "Final delivery"];
  const phases = phaseNames.map((title, index) => ({
    id: randomUUID(), projectId: project.id, kind: "phase", title, description: null, status: index === 0 ? "active" : "planned", priority: "medium", ownerId, parentId: null, category: template, startDate: at(index / 4), dueDate: at((index + 1) / 4), progress: index === 0 ? 10 : 0, sortOrder: index * 100, payload: JSON.stringify({ template }), archived: false, revision: 1,
  }));
  const records: any[] = [...phases];
  milestoneNames.forEach((title, index) => records.push({ id: randomUUID(), projectId: project.id, kind: "milestone", title, description: null, status: "planned", priority: index === 3 ? "high" : "medium", ownerId, parentId: phases[index]?.id || null, category: template, startDate: null, dueDate: at((index + 1) / 4), progress: 0, sortOrder: index * 100 + 20, payload: JSON.stringify({ acceptanceCriteria: [] }), archived: false, revision: 1 }));
  deliverableNames.forEach((title, index) => records.push({ id: randomUUID(), projectId: project.id, kind: "deliverable", title, description: null, status: "planned", priority: index === 3 ? "high" : "medium", ownerId, parentId: phases[index]?.id || null, category: template, startDate: at(index / 4), dueDate: at((index + 1) / 4), progress: 0, sortOrder: index * 100 + 40, payload: JSON.stringify({ completionCriteria: [], approvalRequired: index >= 2 }), archived: false, revision: 1 }));
  records.push(
    { id: randomUUID(), projectId: project.id, kind: "goal", title: "Deliver the approved project outcome", description: project.objective || project.description || null, status: "active", priority: "high", ownerId, parentId: null, category: "delivery", startDate: start, dueDate: target, progress: 0, confidence: 70, sortOrder: 10, payload: JSON.stringify({ targetValue: 100, currentValue: 0, unit: "%" }), archived: false, revision: 1 },
    { id: randomUUID(), projectId: project.id, kind: "onboarding", title: "Read the project brief and conventions", description: null, status: "open", priority: "medium", ownerId, parentId: null, category: "required", startDate: null, dueDate: at(0.1), progress: 0, sortOrder: 10, payload: JSON.stringify({ audience: "all" }), archived: false, revision: 1 },
    { id: randomUUID(), projectId: project.id, kind: "onboarding", title: "Configure repository, tools, and build access", description: null, status: "open", priority: "high", ownerId, parentId: null, category: "access", startDate: null, dueDate: at(0.12), progress: 0, sortOrder: 20, payload: JSON.stringify({ audience: "production" }), archived: false, revision: 1 },
    { id: randomUUID(), projectId: project.id, kind: "responsibility", title: "Project lead", description: "Accountable for delivery health, scope, and approvals.", status: "active", priority: "high", ownerId, parentId: null, category: "accountable", startDate: null, dueDate: null, progress: 0, sortOrder: 10, payload: JSON.stringify({ raci: "accountable" }), archived: false, revision: 1 },
    { id: randomUUID(), projectId: project.id, kind: "baseline", title: "Initial delivery baseline", description: "Original approved scope, dates, staffing, and release target.", status: "approved", priority: "medium", ownerId, parentId: null, category: "schedule", startDate: start, dueDate: target, progress: 100, completedAt: new Date(), sortOrder: 10, payload: JSON.stringify({ objective: project.objective || null, startDate: start.toISOString(), targetDate: target.toISOString(), priority: project.priority || "medium" }), archived: false, revision: 1 },
    { id: randomUUID(), projectId: project.id, kind: "automation", title: "Escalate overdue critical work", description: "Create a project risk when a critical milestone or deliverable becomes overdue.", status: "active", priority: "medium", ownerId, parentId: null, category: "delivery", startDate: null, dueDate: null, progress: 0, sortOrder: 10, payload: JSON.stringify({ trigger: "record_overdue", conditions: [{ field: "priority", operator: "in", value: ["high", "urgent"] }], actions: [{ type: "create_risk", title: "Critical delivery item overdue" }], retryPolicy: { maxAttempts: 3, backoffMinutes: 5, pauseAfterFailures: 3 }, notifyOnFailure: true, enabled: true, runCount: 0 }), archived: false, revision: 1 },
  );
  return records;
}

export function registerProjectControlRoutes(deps: ProjectControlRouteDependencies) {
  const { app, prisma, getCurrentUser, decorateUserForClient, enforceTargetAccess, sendRevisionConflict, logActivity, projectAutomation } = deps;
  const resourceGraph = createResourceGraphService(prisma);

  app.get("/api/projects/:projectId/control-center", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    reply.header("Cache-Control", "private, no-store");
    const [records, relationships] = await Promise.all([
      prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false }, orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }, { updatedAt: "desc" }] }),
      prisma.projectRelationship.findMany({ where: { projectId: project.id }, orderBy: [{ critical: "desc" }, { createdAt: "desc" }] }),
    ]);
    // Project-level view does not imply access to every linked Library item,
    // review asset, person or private work item. The control-center overview
    // must enforce exactly the same endpoint visibility as evidence/graph APIs.
    const visibleRelationships = await visibleWorkflowRelationships(deps, request, project, relationships);
    // Link candidates include names, card titles, Library paths and sensitive
    // review metadata. Project view alone is not permission to enumerate them.
    const enriched = await enrichProjectControlRecords(prisma, project.id, records, (candidate) =>
      canWorkflowEntity(deps, request, project, { kind: candidate.type as ClusterWorkSourceKind, id: candidate.id, projectId: project.id }, "view"));
    const visibleCandidateKeys = new Set(enriched.candidates.map((candidate) => `${candidate.type}:${candidate.id}`));
    const visibleRecords = enriched.records.map((record) => record.linkedEntityId && record.linkedEntityType &&
      !visibleCandidateKeys.has(`${record.linkedEntityType}:${record.linkedEntityId}`)
      ? { ...record, linkedEntityType: null, linkedEntityId: null, linkedEntity: null, linkState: "unlinked" }
      : record);
    return {
      projectId: project.id,
      generatedAt: new Date().toISOString(),
      records: visibleRecords,
      linkCandidates: enriched.candidates,
      relationships: visibleRelationships.map(serializeProjectRelationship),
      summary: buildProjectControlSummary(visibleRecords as any, visibleRelationships),
    };
  });

  app.post("/api/projects/:projectId/control-records", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = recordBodySchema.parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    await Promise.all([validateOwner(prisma, project, body.ownerId), validateParent(prisma, project.id, body.parentId)]);
    if (body.startDate && body.dueDate && body.dueDate.getTime() < body.startDate.getTime()) throw createHttpError("VALIDATION_FAILED", "Due date must be on or after the start date.", 400);
    const record = await prisma.projectControlRecord.create({ data: {
      projectId: project.id, kind: body.kind, title: body.title, description: body.description || null, status: body.status, priority: body.priority,
      ownerId: body.ownerId || null, parentId: body.parentId || null, category: body.category || null, startDate: body.startDate || null, dueDate: body.dueDate || null,
      completedAt: completedAtForStatus(body.status), progress: body.progress, probability: body.probability || null, impact: body.impact || null, confidence: body.confidence ?? null,
      linkedEntityType: body.linkedEntityType || null, linkedEntityId: body.linkedEntityId || null, sortOrder: body.sortOrder || 0, payload: safePayload(body.payload),
    } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: `project_${body.kind}`, entityId: record.id, title: `${body.kind.replaceAll("_", " ")} created`, message: record.title });
    return serializeProjectControlRecord(record);
  });

  app.patch("/api/projects/:projectId/control-records/:recordId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const body = patchBodySchema.parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const existing = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: project.id, archived: false } });
    if (!existing) throw createHttpError("PROJECT_CONTROL_RECORD_NOT_FOUND", "Project control record not found.", 404);
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) return sendRevisionConflict(reply, "project_control_record", serializeProjectControlRecord(existing));
    await Promise.all([validateOwner(prisma, project, body.ownerId), validateParent(prisma, project.id, body.parentId)]);
    const effectiveStart = body.startDate === undefined ? existing.startDate : body.startDate;
    const effectiveDue = body.dueDate === undefined ? existing.dueDate : body.dueDate;
    if (effectiveStart && effectiveDue && new Date(effectiveDue).getTime() < new Date(effectiveStart).getTime()) throw createHttpError("VALIDATION_FAILED", "Due date must be on or after the start date.", 400);
    const { expectedRevision, ...changes } = body;
    const record = await prisma.projectControlRecord.update({ where: { id: existing.id }, data: {
      ...changes,
      description: body.description === undefined ? undefined : body.description || null,
      ownerId: body.ownerId === undefined ? undefined : body.ownerId || null,
      parentId: body.parentId === undefined ? undefined : body.parentId || null,
      category: body.category === undefined ? undefined : body.category || null,
      completedAt: body.status === undefined ? undefined : completedAtForStatus(body.status),
      probability: body.probability === undefined ? undefined : body.probability || null,
      impact: body.impact === undefined ? undefined : body.impact || null,
      confidence: body.confidence === undefined ? undefined : body.confidence,
      linkedEntityType: body.linkedEntityType === undefined ? undefined : body.linkedEntityType || null,
      linkedEntityId: body.linkedEntityId === undefined ? undefined : body.linkedEntityId || null,
      payload: body.payload === undefined ? undefined : safePayload(body.payload),
      revision: { increment: 1 },
    } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: `project_${record.kind}`, entityId: record.id, title: `${record.kind.replaceAll("_", " ")} updated`, message: record.title });
    return serializeProjectControlRecord(record);
  });

  app.delete("/api/projects/:projectId/control-records/:recordId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const existing = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: project.id, archived: false } });
    if (!existing) throw createHttpError("PROJECT_CONTROL_RECORD_NOT_FOUND", "Project control record not found.", 404);
    await prisma.$transaction([
      prisma.projectRelationship.deleteMany({ where: { projectId: project.id, OR: [{ sourceType: "control", sourceId: existing.id }, { targetType: "control", targetId: existing.id }] } }),
      prisma.projectControlRecord.update({ where: { id: existing.id }, data: { archived: true, revision: { increment: 1 } } }),
    ]);
    await logActivity({ userId: user?.id, projectId: project.id, type: "archived", entityType: `project_${existing.kind}`, entityId: existing.id, title: `${existing.kind.replaceAll("_", " ")} archived`, message: existing.title });
    return { ok: true };
  });


  app.get("/api/projects/:projectId/workflow-links", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ kind: z.enum(WORK_SOURCE_KIND_SCHEMA_VALUES), id: z.string().trim().min(1).max(200) }).parse(request.query);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const subject: ClusterWorkSource = { kind: query.kind, id: query.id, projectId: project.id };
    await validateWorkflowEntity(prisma, project, subject);
    if (!(await requireWorkflowEntity(deps, request, reply, project, subject, "view"))) return;
    const relationships = await prisma.projectRelationship.findMany({
      where: {
        projectId: project.id,
        OR: [
          { sourceType: query.kind, sourceId: query.id },
          { targetType: query.kind, targetId: query.id },
        ],
      },
      orderBy: [{ critical: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const visibleRelationships = await visibleWorkflowRelationships(deps, request, project, relationships);
    const canEdit = await canWorkflowEntity(deps, request, project, subject, "contribute");
    return buildProjectWorkflowLinksPayload(prisma, project, subject, visibleRelationships, canEdit);
  });

  app.get("/api/projects/:projectId/workflow-graph", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    const query = z.object({
      kind: z.enum(WORK_SOURCE_KIND_SCHEMA_VALUES),
      id: z.string().trim().min(1).max(200),
      depth: z.coerce.number().int().min(0).max(4).optional().default(2),
      maxEdges: z.coerce.number().int().min(1).max(1000).optional().default(250),
      direction: z.enum(["both", "incoming", "outgoing"]).optional().default("both"),
      category: z.enum(CLUSTER_RESOURCE_GRAPH_CATEGORIES).optional(),
      criticalOnly: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
      blockingOnly: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
    }).parse(request.query);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const subject: ClusterWorkSource = { kind: query.kind, id: query.id, projectId: project.id };
    await validateWorkflowEntity(prisma, project, subject);
    if (!(await requireWorkflowEntity(deps, request, reply, project, subject, "view"))) return;
    const neighborhood = await resourceGraph.neighborhood({
      subject,
      projectId: project.id,
      depth: query.depth,
      maxEdges: query.maxEdges,
      direction: query.direction,
      category: query.category,
      criticalOnly: query.criticalOnly,
      blockingOnly: query.blockingOnly,
    }, {
      allowResource: (resource) => canReadExistingWorkflowEntity(deps, request, project, resource as ClusterWorkSource),
    });
    // The graph may include private Library items, People, and restricted work.
    // Resolve display names ONLY for the server-authorized neighborhood. Never
    // hydrate candidates before filtering ACLs or source-folder restrictions.
    const labels = await hydrateProjectWorkflowSources(prisma, project,
      neighborhood.nodes.map((node) => node.resource as ClusterWorkSource));
    return {
      ...neighborhood,
      nodes: neighborhood.nodes.map((node) => {
        const view = labels.get(`${node.resource.kind}:${node.resource.id}`);
        return { ...node, label: view?.label, context: view?.context };
      }),
    };
  });

  app.get("/api/projects/:projectId/evidence", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ kind: z.enum(WORK_SOURCE_KIND_SCHEMA_VALUES), id: z.string().trim().min(1).max(200) }).parse(request.query);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const subject: ClusterWorkSource = { kind: query.kind, id: query.id, projectId: project.id };
    await validateWorkflowEntity(prisma, project, subject);
    if (!(await requireWorkflowEntity(deps, request, reply, project, subject, "view"))) return;
    const relationships = await prisma.projectRelationship.findMany({
      where: { projectId: project.id, OR: [{ sourceType: query.kind, sourceId: query.id }, { targetType: query.kind, targetId: query.id }] },
      orderBy: [{ critical: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const visibleRelationships = await visibleWorkflowRelationships(deps, request, project, relationships);
    const canEdit = await canWorkflowEntity(deps, request, project, subject, "contribute");
    const workflow = await buildProjectWorkflowLinksPayload(prisma, project, subject, visibleRelationships, canEdit);
    const canUpload = await deps.requestCanTarget(request, "file", "__new__", project, "contribute");
    return buildProjectEvidencePayload(prisma, project, workflow, canUpload);
  });

  app.get("/api/projects/:projectId/evidence-candidates", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ q: z.string().trim().max(160).optional().default(""), limit: z.coerce.number().int().min(10).max(80).optional() }).parse(request.query);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const candidates = await searchProjectEvidenceCandidates(prisma, project, query);
    const visible = (await Promise.all(candidates.map(async (candidate) => ({ candidate, allowed: await canWorkflowEntity(deps, request, project, candidate.resource, "view") })))).filter((entry) => entry.allowed).map((entry) => entry.candidate);
    return { projectId: project.id, candidates: visible };
  });

  app.get("/api/projects/:projectId/workflow-link-candidates", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({
      q: z.string().trim().max(160).optional().default(""),
      kind: z.enum(WORK_SOURCE_KIND_SCHEMA_VALUES).optional(),
      excludeKind: z.enum(WORK_SOURCE_KIND_SCHEMA_VALUES).optional(),
      excludeId: z.string().trim().max(200).optional(),
      limit: z.coerce.number().int().min(10).max(120).optional(),
    }).parse(request.query);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const payload = await searchProjectWorkflowCandidates(prisma, project, query);
    const visible = (await Promise.all(payload.candidates.map(async (candidate) => ({ candidate, allowed: await canWorkflowEntity(deps, request, project, candidate, "view") })))).filter((entry) => entry.allowed).map((entry) => entry.candidate);
    return { ...payload, candidates: visible };
  });

  app.post("/api/projects/:projectId/workflow-links", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = workflowLinkInputSchema.parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    await validateWorkflowEntity(prisma, project, body.source);
    await validateWorkflowEntity(prisma, project, body.target);
    if (!(await requireWorkflowEntity(deps, request, reply, project, body.source, "contribute"))) return;
    if (!(await requireWorkflowEntity(deps, request, reply, project, body.target, "view"))) return;
    if (body.source.kind === body.target.kind && body.source.id === body.target.id) throw createHttpError("VALIDATION_FAILED", "A work item cannot link to itself.", 400);
    const cycle = await cardRelationshipGraphDiagnostic(prisma, project.id, body.source, body.target, body.relationship);
    if (cycle?.code === "CARD_DEPENDENCY_EXISTS") throw createHttpError("CARD_DEPENDENCY_EXISTS", "That Card dependency is already represented by an equivalent relationship.", 409);
    if (cycle?.code === "CARD_DEPENDENCY_CYCLE") throw createHttpError("CARD_DEPENDENCY_CYCLE", `That Card dependency would create a cycle (${cycle.path.join(" → ")}). Remove or reverse an existing dependency first.`, 409);
    if (cycle?.code === "CARD_HIERARCHY_CYCLE") throw createHttpError("CARD_HIERARCHY_CYCLE", `That parent/child relationship would create a hierarchy cycle (${cycle.path.join(" → ")}). Remove or reverse an existing hierarchy link first.`, 409);
    // POST is a create-or-return operation. A lost response can cause Desktop
    // to replay this request after the relationship already exists. Never
    // rewrite createdById (or description) and never create a duplicate
    // human activity entry just because the client is recovering.
    const identity = { projectId: project.id, sourceType: body.source.kind, sourceId: body.source.id,
      targetType: body.target.kind, targetId: body.target.id, relationship: body.relationship };
    let relationship: any;
    let created = false;
    try {
      relationship = await prisma.projectRelationship.create({
        data: { ...identity, description: body.description || null, critical: Boolean(body.critical), createdById: user?.id || null },
      });
      created = true;
    } catch (error) {
      // The database unique constraint settles concurrent identical creates.
      // Only a proven identity collision is a replay; all other failures fail.
      if ((error as { code?: string })?.code !== "P2002") throw error;
      relationship = await prisma.projectRelationship.findUnique({
        where: { projectId_sourceType_sourceId_targetType_targetId_relationship: identity },
      });
      if (!relationship) throw error;
    }
    // Backlink creation is idempotent and also repairs a partial prior commit
    // if the process died after the relationship row was written.
    await syncWorkflowLibraryBacklinks(prisma, relationship);
    if (created) {
      await logActivity({ userId: user?.id, projectId: project.id, type: "linked", entityType: "project_relationship", entityId: relationship.id, title: "Workflow objects linked", message: body.relationship.replaceAll("_", " "), metadata: { sourceType: body.source.kind, sourceId: body.source.id, targetType: body.target.kind, targetId: body.target.id } });
    }
    return serializeProjectRelationship(relationship);
  });

  app.patch("/api/projects/:projectId/workflow-links/:relationshipId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), relationshipId: z.string() }).parse(request.params);
    const body = workflowLinkPatchSchema.parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const existing = await prisma.projectRelationship.findFirst({ where: { id: params.relationshipId, projectId: project.id } });
    if (!existing) throw createHttpError("PROJECT_RELATIONSHIP_NOT_FOUND", "Project relationship not found.", 404);
    const existingSource = { kind: existing.sourceType, id: existing.sourceId, projectId: project.id } as ClusterWorkSource;
    const existingTarget = { kind: existing.targetType, id: existing.targetId, projectId: project.id } as ClusterWorkSource;
    if (!(await requireWorkflowEntity(deps, request, reply, project, existingSource, "contribute"))) return;
    if (!(await requireWorkflowEntity(deps, request, reply, project, existingTarget, "view"))) return;
    const nextRelationship = body.relationship || existing.relationship;
    const cycle = await cardRelationshipGraphDiagnostic(prisma, project.id, existingSource, existingTarget, nextRelationship, existing.id);
    if (cycle?.code === "CARD_DEPENDENCY_EXISTS") throw createHttpError("CARD_DEPENDENCY_EXISTS", "That Card dependency is already represented by an equivalent relationship.", 409);
    if (cycle?.code === "CARD_DEPENDENCY_CYCLE") throw createHttpError("CARD_DEPENDENCY_CYCLE", `That Card dependency would create a cycle (${cycle.path.join(" → ")}). Remove or reverse an existing dependency first.`, 409);
    if (cycle?.code === "CARD_HIERARCHY_CYCLE") throw createHttpError("CARD_HIERARCHY_CYCLE", `That parent/child relationship would create a hierarchy cycle (${cycle.path.join(" → ")}). Remove or reverse an existing hierarchy link first.`, 409);
    if (nextRelationship !== existing.relationship) {
      const duplicate = await prisma.projectRelationship.findFirst({ where: { projectId: project.id, sourceType: existing.sourceType, sourceId: existing.sourceId, targetType: existing.targetType, targetId: existing.targetId, relationship: nextRelationship, NOT: { id: existing.id } }, select: { id: true } });
      if (duplicate) throw createHttpError("PROJECT_RELATIONSHIP_EXISTS", "That relationship already exists between these work items.", 409);
    }
    const relationship = await prisma.projectRelationship.update({
      where: { id: existing.id },
      data: {
        relationship: nextRelationship,
        ...(Object.prototype.hasOwnProperty.call(body, "description") ? { description: body.description || null } : {}),
        ...(typeof body.critical === "boolean" ? { critical: body.critical } : {}),
        createdById: user?.id || existing.createdById || null,
      },
    });
    await syncWorkflowLibraryBacklinks(prisma, relationship);
    await logActivity({ userId: user?.id, projectId: project.id, type: "linked", entityType: "project_relationship", entityId: relationship.id, title: "Workflow relationship updated", message: relationship.relationship.replaceAll("_", " "), metadata: { sourceType: relationship.sourceType, sourceId: relationship.sourceId, targetType: relationship.targetType, targetId: relationship.targetId, critical: Boolean(relationship.critical) } });
    return serializeProjectRelationship(relationship);
  });

  app.delete("/api/projects/:projectId/workflow-links/:relationshipId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), relationshipId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const existing = await prisma.projectRelationship.findFirst({ where: { id: params.relationshipId, projectId: project.id } });
    if (!existing) throw createHttpError("PROJECT_RELATIONSHIP_NOT_FOUND", "Project relationship not found.", 404);
    const existingSource = { kind: existing.sourceType, id: existing.sourceId, projectId: project.id } as ClusterWorkSource;
    const existingTarget = { kind: existing.targetType, id: existing.targetId, projectId: project.id } as ClusterWorkSource;
    if (!(await requireWorkflowEntity(deps, request, reply, project, existingSource, "contribute"))) return;
    if (!(await requireWorkflowEntity(deps, request, reply, project, existingTarget, "view"))) return;
    await prisma.projectRelationship.delete({ where: { id: existing.id } });
    await removeWorkflowLibraryBacklinks(prisma, existing);
    await logActivity({ userId: user?.id, projectId: project.id, type: "unlinked", entityType: "project_relationship", entityId: existing.id, title: "Workflow relationship removed", message: existing.relationship.replaceAll("_", " "), metadata: { sourceType: existing.sourceType, sourceId: existing.sourceId, targetType: existing.targetType, targetId: existing.targetId } });
    return { ok: true };
  });

  app.post("/api/projects/:projectId/relationships", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({
      sourceType: z.string().trim().min(1).max(64), sourceId: z.string().trim().min(1).max(200), targetType: z.string().trim().min(1).max(64), targetId: z.string().trim().min(1).max(200),
      relationship: z.enum(CLUSTER_WORKFLOW_RELATIONSHIPS),
      description: z.string().trim().max(1000).optional().nullable(), critical: z.boolean().default(false),
    }).parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    if (body.sourceType === "control") await validateParent(prisma, project.id, body.sourceId);
    if (body.sourceType === "project" && body.sourceId !== project.id) throw createHttpError("VALIDATION_FAILED", "Relationship source project must be the current project.", 400);
    if (body.targetType === "control") await validateParent(prisma, project.id, body.targetId);
    if (body.targetType === "project") {
      const targetProject = await ensureProject(prisma, body.targetId);
      if (!(await enforceTargetAccess(request, reply, "project", targetProject.id, targetProject, "view"))) return;
    }
    const relationship = await prisma.projectRelationship.upsert({
      where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType: body.sourceType, sourceId: body.sourceId, targetType: body.targetType, targetId: body.targetId, relationship: body.relationship } },
      update: { description: body.description || null, critical: body.critical, createdById: user?.id || null },
      create: { projectId: project.id, ...body, description: body.description || null, createdById: user?.id || null },
    });
    await logActivity({ userId: user?.id, projectId: project.id, type: "linked", entityType: "project_relationship", entityId: relationship.id, title: "Project relationship added", message: body.relationship.replaceAll("_", " ") });
    return serializeProjectRelationship(relationship);
  });

  app.delete("/api/projects/:projectId/relationships/:relationshipId", async (request, reply) => {
    const params = z.object({ projectId: z.string(), relationshipId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await prisma.projectRelationship.deleteMany({ where: { id: params.relationshipId, projectId: project.id } });
    if (!result.count) throw createHttpError("PROJECT_RELATIONSHIP_NOT_FOUND", "Project relationship not found.", 404);
    return { ok: true };
  });

  app.post("/api/projects/:projectId/control-center/bootstrap", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ template: z.enum(["game-production", "software", "content", "client-delivery"]), replace: z.boolean().default(false) }).parse(request.body);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const existingCount = await prisma.projectControlRecord.count({ where: { projectId: project.id, archived: false } });
    if (existingCount && !body.replace) throw createHttpError("PROJECT_CONTROL_ALREADY_CONFIGURED", "Project control records already exist. Choose replace to rebuild them from a template.", 409);
    const decorated = await decorateUserForClient(user);
    const assignedIds = Array.isArray(project.memberships) ? project.memberships.map((membership: any) => String(membership.userId || "")).filter(Boolean) : [];
    const ownerId = assignedIds[0] || user?.id || null;
    const records = templateRecords(body.template, project, ownerId);
    await prisma.$transaction(async (transaction: any) => {
      if (body.replace) {
        await transaction.projectRelationship.deleteMany({ where: { projectId: project.id } });
        await transaction.projectControlRecord.updateMany({ where: { projectId: project.id, archived: false }, data: { archived: true, revision: { increment: 1 } } });
      }
      await transaction.projectControlRecord.createMany({ data: records });
    });
    await logActivity({ userId: user?.id, projectId: project.id, type: "configured", entityType: "project_control_center", entityId: project.id, title: "Project control template applied", message: `${body.template} · ${records.length} records · ${decorated?.displayName || decorated?.username || "member"}` });
    return { ok: true, template: body.template, created: records.length };
  });

  app.post("/api/projects/:projectId/status-reports/generate", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ title: z.string().trim().max(240).optional(), publish: z.boolean().default(false) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const [records, relationships] = await Promise.all([
      prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false } }),
      prisma.projectRelationship.findMany({ where: { projectId: project.id } }),
    ]);
    const draft = buildStatusReportDraft(project, records, relationships);
    const report = await prisma.projectControlRecord.create({ data: {
      projectId: project.id, kind: "status_report", title: body.title || `Status report · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      description: String(draft.executiveSummary), status: body.publish ? "published" : "draft", priority: "medium", ownerId: user?.id || null, category: "weekly", progress: body.publish ? 100 : 0,
      completedAt: body.publish ? new Date() : null, payload: JSON.stringify(draft), sortOrder: Date.now() % 100000,
    } });
    await logActivity({ userId: user?.id, projectId: project.id, type: body.publish ? "published" : "generated", entityType: "project_status_report", entityId: report.id, title: body.publish ? "Status report published" : "Status report generated", message: report.title });
    return serializeProjectControlRecord(report);
  });

  app.post("/api/projects/:projectId/control-records/:recordId/run", async (request, reply) => {
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const body = z.object({ dryRun: z.boolean().default(true) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const rule = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: project.id, kind: "automation", archived: false } });
    if (!rule) throw createHttpError("PROJECT_AUTOMATION_NOT_FOUND", "Project automation rule not found.", 404);
    if (body.dryRun) return projectAutomation.executeRule(rule, { dryRun: true });
    const queued = await projectAutomation.enqueueRuleExecution(rule, { context: { trigger: "manual", actorUserId: null, projectId: project.id, sourceType: "automation", sourceId: rule.id, source: { id: rule.id, title: rule.title } } });
    return { ok: true, queued: true, ...queued };
  });
}
