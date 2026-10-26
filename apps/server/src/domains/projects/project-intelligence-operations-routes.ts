import { z } from "zod";
import { createHttpError } from "../../core/http-errors.js";
import { createProjectIntelligenceOperationsService } from "./project-intelligence-operations-service.js";

export function registerProjectIntelligenceOperationsRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, readSettings, logActivity, projectReadModels }: { app: any; prisma: any; getCurrentUser: (request: any) => Promise<any>; enforceTargetAccess: (...args: any[]) => Promise<any>; readSettings: (force?: boolean) => Promise<any>; logActivity: (input: any) => Promise<unknown>; projectReadModels?: any }) {
  const service = createProjectIntelligenceOperationsService(prisma, readSettings, projectReadModels);
  const projectFor = async (projectId: string) => {
    const project = await prisma.project.findFirst({ where: { id: projectId, archived: false }, include: { memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true } } } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    return project;
  };

  app.get("/api/projects/:projectId/intelligence/pipeline", async (request: any, reply: any) => {
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    return service.pipelineSnapshot(project);
  });

  app.post("/api/projects/:projectId/intelligence/pipeline/ensure", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await service.ensurePipeline(project, user?.id || null);
    await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: "project", entityId: project.id, title: "Delivery pipeline synchronized", message: `${result.created} stage${result.created === 1 ? "" : "s"} created · ${result.linked} dependency link${result.linked === 1 ? "" : "s"} ensured`, metadata: { source: "project-intelligence-c2" } });
    return { ok: true, ...result, pipeline: await service.pipelineSnapshot(project) };
  });

  app.post("/api/projects/:projectId/intelligence/pipeline/reconcile", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await service.reconcilePipeline(project);
    if (result.activated) await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: "project", entityId: project.id, title: "Delivery pipeline advanced", message: `${result.activated} stage${result.activated === 1 ? "" : "s"} activated after prerequisites cleared`, metadata: { changes: result.changes, source: "project-intelligence-c2" } });
    return { ok: true, ...result, pipeline: await service.pipelineSnapshot(project) };
  });

  app.post("/api/projects/:projectId/intelligence/pipeline/schedule", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const body = z.object({ stage: z.string().trim().min(1).max(80), startsAt: z.coerce.date().optional().nullable(), endsAt: z.coerce.date().optional().nullable(), allowConflict: z.boolean().default(false) }).parse(request.body || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    let result: any;
    try { result = await service.schedulePipelineStage(project, body.stage, { startsAt: body.startsAt, endsAt: body.endsAt, allowConflict: body.allowConflict, actorId: user?.id || null }); }
    catch (error: any) { throw createHttpError("VALIDATION_FAILED", error?.message || "That delivery stage cannot be scheduled.", 400); }
    if (result.conflictRequired) return reply.code(409).send({ code: "SCHEDULER_CONFLICT", message: "The stage owner already has overlapping scheduled work. Review conflicts or explicitly allow overbooking.", conflicts: result.conflicts, stage: result.stage });
    await logActivity({ userId: user?.id, projectId: project.id, type: "scheduled", entityType: "project_delivery_stage", entityId: result.stage.recordId, title: `${result.stage.label} scheduled`, message: `${new Date(result.block.startsAt).toISOString()} → ${new Date(result.block.endsAt).toISOString()}${result.conflicts.length ? ` · ${result.conflicts.length} conflict override(s)` : ""}`, metadata: { stage: body.stage, scheduleBlockId: result.block.id, conflicts: result.conflicts.map((item: any) => item.id), source: "project-intelligence-c3" } });
    return { ok: true, ...result, pipeline: await service.pipelineSnapshot(project) };
  });

  app.post("/api/projects/:projectId/intelligence/pipeline/gate-policy/apply", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const body = z.object({ channel: z.string().trim().min(1).max(40).default("release") }).parse(request.body || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await service.applyProjectTypeGatePolicy(project, user?.id || null, body.channel);
    const policy = result.policy;
    if (!result.applied || !policy) throw createHttpError("VALIDATION_FAILED", result.reason || "No Project-Type delivery policy is available.", 409);
    await logActivity({ userId: user?.id, projectId: project.id, type: "delivery_policy_updated", entityType: "project_delivery_policy", entityId: result.recordId, title: "Project-Type delivery policy applied", message: `${body.channel} · ${policy.requiredGateIds.length} required gate(s)`, metadata: { projectTypeId: policy.projectTypeId, source: "project-intelligence-c3" } });
    return { ok: true, ...result, pipeline: await service.pipelineSnapshot(project) };
  });

  app.post("/api/projects/:projectId/intelligence/project-dependencies", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = z.object({ projectId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const body = z.object({ targetProjectId: z.string().trim().min(1).max(200), relationship: z.enum(["depends_on", "blocks"]), critical: z.boolean().default(false), description: z.string().trim().max(2000).optional().default(""), ownerId: z.string().trim().max(200).optional().nullable(), dueDate: z.coerce.date().optional().nullable() }).parse(request.body || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const target = await projectFor(body.targetProjectId);
    if (target.workspaceId !== project.workspaceId) throw createHttpError("VALIDATION_FAILED", "Cross-project dependencies must stay inside the same Studio.", 400);
    if (target.id === project.id) throw createHttpError("VALIDATION_FAILED", "A project cannot depend on itself.", 400);
    if (body.ownerId) {
      const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: body.ownerId, user: { archived: false } }, select: { userId: true } });
      if (!member) throw createHttpError("VALIDATION_FAILED", "Dependency owner must be an active Studio member.", 400);
    }
    const row = await prisma.projectRelationship.upsert({
      where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType: "project", sourceId: project.id, targetType: "project", targetId: target.id, relationship: body.relationship } },
      update: { critical: body.critical, description: body.description || null, createdById: user?.id || null },
      create: { projectId: project.id, sourceType: "project", sourceId: project.id, targetType: "project", targetId: target.id, relationship: body.relationship, critical: body.critical, description: body.description || null, createdById: user?.id || null },
    });
    const category = `cross-project-dependency:${row.id}`;
    const existingControl = await prisma.projectControlRecord.findFirst({ where: { projectId: project.id, kind: "dependency", category, archived: false } });
    const controlData = { title: `${project.name} ${body.relationship.replaceAll("_", " ")} ${target.name}`, description: body.description || `Cross-project dependency on ${target.name}.`, status: "open", priority: body.critical ? "urgent" : "high", ownerId: body.ownerId || null, dueDate: body.dueDate || target.targetDate || null, linkedEntityType: "project", linkedEntityId: target.id, payload: JSON.stringify({ relationshipId: row.id, targetProjectId: target.id, relationship: body.relationship, critical: body.critical, source: "project-intelligence-c2" }) };
    const controlRecord = existingControl ? await prisma.projectControlRecord.update({ where: { id: existingControl.id }, data: { ...controlData, revision: { increment: 1 } } }) : await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: "dependency", ...controlData } });
    service.invalidateProject(project.id);
    await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: "project_dependency", entityId: controlRecord.id, title: "Cross-project dependency updated", message: `${project.name} ${body.relationship.replaceAll("_", " ")} ${target.name}`, metadata: { relationshipId: row.id, targetProjectId: target.id, critical: body.critical, ownerId: body.ownerId || null, dueDate: body.dueDate || target.targetDate || null } });
    return { ok: true, relationship: row, controlRecord: { id: controlRecord.id, title: controlRecord.title, ownerId: controlRecord.ownerId, dueDate: controlRecord.dueDate, priority: controlRecord.priority }, target: { id: target.id, name: target.name, targetDate: target.targetDate, status: target.status } };
  });

  app.delete("/api/projects/:projectId/intelligence/project-dependencies/:relationshipId", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), relationshipId: z.string() }).parse(request.params || {});
    const project = await projectFor(params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const row = await prisma.projectRelationship.findFirst({ where: { id: params.relationshipId, projectId: project.id, sourceType: "project", sourceId: project.id, targetType: "project" } });
    if (!row) throw createHttpError("PROJECT_RELATIONSHIP_NOT_FOUND", "Cross-project dependency not found.", 404);
    await prisma.$transaction([
      prisma.projectRelationship.delete({ where: { id: row.id } }),
      prisma.projectControlRecord.updateMany({ where: { projectId: project.id, kind: "dependency", category: `cross-project-dependency:${row.id}`, archived: false }, data: { archived: true, revision: { increment: 1 } } }),
    ]);
    service.invalidateProject(project.id);
    await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: "project", entityId: project.id, title: "Cross-project dependency removed", message: row.description || row.relationship, metadata: { relationshipId: row.id } });
    return { ok: true, id: row.id };
  });

  async function adminWorkspaceFor(request: any) {
    const user = await getCurrentUser(request);
    if (!user?.isAdmin) throw createHttpError("PERMISSION_DENIED", "Admin role required for Studio portfolio intelligence.", 403);
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id }, select: { workspaceId: true }, orderBy: { createdAt: "asc" } });
    if (!membership?.workspaceId) throw createHttpError("WORKSPACE_NOT_READY", "No Studio workspace is available for portfolio intelligence.", 409);
    return { user, workspaceId: membership.workspaceId };
  }

  // Studio-wide portfolio is a workspace read model, not a project child.
  app.get("/api/portfolio/intelligence", async (request: any) => {
    const { workspaceId } = await adminWorkspaceFor(request);
    return service.portfolioSnapshot(workspaceId);
  });

  app.get("/api/portfolio/intelligence/history", async (request: any) => {
    const query = z.object({ limit: z.coerce.number().int().min(2).max(90).default(30) }).parse(request.query || {});
    const { workspaceId } = await adminWorkspaceFor(request);
    return { workspaceId, samples: await service.portfolioHistory(workspaceId, query.limit) };
  });


}
