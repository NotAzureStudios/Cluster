import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveClusterProjectType } from "@cluster/shared";
import { projectAutomationTemplatesForType } from "./project-automation-templates.js";
import { createHttpError } from "../../core/http-errors.js";
import { createProjectAutomationGovernanceService } from "./project-automation-governance-service.js";

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  readSettings: (force?: boolean) => Promise<any>;
  projectAutomation: {
    executeRule: (ruleOrId: any, options?: any) => Promise<any>;
    enqueueRuleExecution: (ruleOrId: any, options?: any) => Promise<any>;
    evaluateOverdue: (projectId?: string | null) => Promise<any>;
    evaluateScheduled: (projectId?: string | null) => Promise<any>;
    listRuns: (projectId: string, ruleId?: string | null, limit?: number) => Promise<any[]>;
  };
};

async function ensureProject(prisma: any, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return project;
}

async function validateOwner(prisma: any, project: any, ownerId?: string | null) {
  if (!ownerId) return;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: ownerId, user: { archived: false } }, select: { userId: true } });
  if (!member) throw createHttpError("VALIDATION_FAILED", "Automation owner must be an active workspace member.", 400);
}

function parsePayload(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function exportPayload(value: unknown) {
  const payload = parsePayload(value);
  const runtimeKeys = ["runCount", "lastRunAt", "lastResult", "consecutiveFailures", "disabledReason"];
  for (const key of runtimeKeys) delete payload[key];
  return payload;
}
function governancePayload(payload: Record<string, any>, state: "draft" | "published", userId?: string | null) {
  const current = parsePayload(payload.governance);
  const version = Math.max(1, Number(current.version || 0) + (state === "published" ? 1 : 0));
  return { ...payload, governance: { ...current, state, version, updatedAt: new Date().toISOString(), updatedById: userId || null, ...(state === "published" ? { publishedAt: new Date().toISOString(), publishedById: userId || null } : {}) } };
}

export function registerProjectAutomationRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, readSettings, projectAutomation }: Dependencies) {
  const automationGovernance = createProjectAutomationGovernanceService(prisma);
  app.get("/api/projects/:projectId/automation-templates", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const settings = await readSettings();
    const definition = resolveClusterProjectType(project.projectType || "general", settings.projectTypePresets);
    return { projectId: project.id, projectType: definition.id, templates: projectAutomationTemplatesForType(definition) };
  });

  app.post("/api/projects/:projectId/automation-templates/:templateId/apply", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), templateId: z.string().trim().min(1).max(120) }).parse(request.params);
    const body = z.object({ ownerId: z.string().trim().max(200).optional().nullable(), replaceExisting: z.boolean().default(false) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    await validateOwner(prisma, project, body.ownerId);
    const settings = await readSettings();
    const definition = resolveClusterProjectType(project.projectType || "general", settings.projectTypePresets);
    const template = projectAutomationTemplatesForType(definition).find((item) => item.id === params.templateId);
    if (!template) throw createHttpError("VALIDATION_FAILED", "That automation template is not available for this project type.", 400);
    const existing = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, kind: "automation", archived: false }, take: 200 });
    const sameTemplate = existing.find((record: any) => { try { return JSON.parse(record.payload || "{}").templateId === template.id; } catch { return false; } });
    if (sameTemplate && !body.replaceExisting) throw createHttpError("PROJECT_AUTOMATION_TEMPLATE_EXISTS", "That automation template is already installed for this project.", 409);
    const templatePayload = governancePayload({ ...template.payload, templateId: template.id }, "published", user?.id || null);
    const data = { title: template.title, description: template.description, status: "active", priority: "medium", ownerId: body.ownerId || user?.id || null, category: `automation-template:${template.id}`, payload: JSON.stringify(templatePayload), progress: 0 };
    const beforePayload = sameTemplate ? parsePayload(sameTemplate.payload) : {};
    const rule = sameTemplate
      ? await prisma.projectControlRecord.update({ where: { id: sameTemplate.id }, data: { ...data, revision: { increment: 1 } } })
      : await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: "automation", ...data } });
    await automationGovernance.recordVersion({ rule, before: beforePayload, after: parsePayload(rule.payload), actorId: user?.id || null, reason: sameTemplate ? "template_replaced" : "template_installed" });
    return { ok: true, templateId: template.id, ruleId: rule.id, replaced: Boolean(sameTemplate) };
  });

  app.get("/api/projects/:projectId/automations/export", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const rules = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, kind: "automation", archived: false }, orderBy: { updatedAt: "asc" }, take: 200 });
    return { schemaVersion: 1, projectId: project.id, projectType: project.projectType, exportedAt: new Date().toISOString(), exportedById: user?.id || null, rules: rules.map((rule: any) => ({ title: rule.title, description: rule.description || "", priority: rule.priority, ownerId: rule.ownerId || null, category: rule.category || null, status: rule.status, payload: exportPayload(rule.payload) })) };
  });

  app.post("/api/projects/:projectId/automations/import", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ bundle: z.object({ schemaVersion: z.literal(1), rules: z.array(z.object({ title: z.string().trim().min(1).max(240), description: z.string().max(8000).optional().default(""), priority: z.string().max(40).optional().default("medium"), ownerId: z.string().max(200).optional().nullable(), category: z.string().max(200).optional().nullable(), payload: z.record(z.any()).default({}) })).max(50) }), publish: z.boolean().default(false) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const created: any[] = [];
    for (const rule of body.bundle.rules) {
      await validateOwner(prisma, project, rule.ownerId);
      const payload = governancePayload({ ...rule.payload, importedAt: new Date().toISOString(), importedById: user?.id || null }, body.publish ? "published" : "draft", user?.id || null);
      const record = await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: "automation", title: rule.title, description: rule.description || null, status: body.publish ? "active" : "draft", priority: rule.priority || "medium", ownerId: rule.ownerId || user?.id || null, category: rule.category || "automation-import", payload: JSON.stringify(payload), progress: 0 } });
      await automationGovernance.recordVersion({ rule: record, before: {}, after: payload, actorId: user?.id || null, reason: "imported" });
      created.push({ id: record.id, title: record.title, status: record.status });
    }
    return { ok: true, imported: created.length, published: body.publish, rules: created };
  });

  app.post("/api/projects/:projectId/automations/:ruleId/governance", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), ruleId: z.string() }).parse(request.params);
    const body = z.object({ state: z.enum(["draft", "published"]), expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const rule = await prisma.projectControlRecord.findFirst({ where: { id: params.ruleId, projectId: project.id, kind: "automation", archived: false } });
    if (!rule) throw createHttpError("PROJECT_AUTOMATION_NOT_FOUND", "Project automation rule not found.", 404);
    if (body.expectedRevision !== undefined && body.expectedRevision !== rule.revision) return reply.code(409).send({ code: "REVISION_CONFLICT", message: "This automation changed on the server. Refresh and retry." });
    const beforePayload = parsePayload(rule.payload);
    const payload = governancePayload(beforePayload, body.state, user?.id || null);
    const updated = await prisma.projectControlRecord.update({ where: { id: rule.id }, data: { status: body.state === "published" ? "active" : "draft", payload: JSON.stringify(payload), revision: { increment: 1 } } });
    await automationGovernance.recordVersion({ rule: updated, before: beforePayload, after: payload, actorId: user?.id || null, reason: body.state === "published" ? "published" : "moved_to_draft" });
    return { ok: true, id: updated.id, status: updated.status, revision: updated.revision, governance: parsePayload(updated.payload).governance };
  });

  app.get("/api/projects/:projectId/automations/:ruleId/versions", async (request, reply) => {
    await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), ruleId: z.string() }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const rule = await prisma.projectControlRecord.findFirst({ where: { id: params.ruleId, projectId: project.id, kind: "automation", archived: false } });
    if (!rule) throw createHttpError("PROJECT_AUTOMATION_NOT_FOUND", "Project automation rule not found.", 404);
    return { projectId: project.id, ruleId: rule.id, versions: await automationGovernance.versions(project.id, rule.id, query.limit) };
  });

  app.post("/api/projects/:projectId/automations/:ruleId/copy", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), ruleId: z.string() }).parse(request.params);
    const body = z.object({ targetProjectId: z.string().trim().min(1).max(200), ownerId: z.string().trim().max(200).optional().nullable(), publish: z.boolean().default(false) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const target = await ensureProject(prisma, body.targetProjectId);
    if (target.workspaceId !== project.workspaceId) throw createHttpError("VALIDATION_FAILED", "Automation copies must stay inside the same Studio.", 400);
    if (!(await enforceTargetAccess(request, reply, "project", target.id, target, "manage"))) return;
    await validateOwner(prisma, target, body.ownerId);
    const rule = await prisma.projectControlRecord.findFirst({ where: { id: params.ruleId, projectId: project.id, kind: "automation", archived: false } });
    if (!rule) throw createHttpError("PROJECT_AUTOMATION_NOT_FOUND", "Project automation rule not found.", 404);
    const sourcePayload = exportPayload(rule.payload);
    const payload = governancePayload({ ...sourcePayload, copiedFromProjectId: project.id, copiedFromRuleId: rule.id, copiedAt: new Date().toISOString(), copiedById: user?.id || null }, body.publish ? "published" : "draft", user?.id || null);
    const copy = await prisma.projectControlRecord.create({ data: { projectId: target.id, kind: "automation", title: rule.title, description: rule.description, status: body.publish ? "active" : "draft", priority: rule.priority, ownerId: body.ownerId || user?.id || null, category: rule.category || "automation-copy", payload: JSON.stringify(payload), progress: 0 } });
    await automationGovernance.recordVersion({ rule: copy, before: {}, after: payload, actorId: user?.id || null, reason: "copied" });
    return { ok: true, ruleId: copy.id, targetProjectId: target.id, published: body.publish, projectTypeChanged: String(project.projectType || "general") !== String(target.projectType || "general") };
  });

  app.get("/api/projects/:projectId/automations/governance/studio", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!user?.isAdmin) throw createHttpError("PERMISSION_DENIED", "Admin role required for Studio automation governance.", 403);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    return automationGovernance.studioGovernance(project.workspaceId);
  });

  app.post("/api/projects/:projectId/automations/:ruleId/test", async (request, reply) => {
    await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), ruleId: z.string() }).parse(request.params);
    const body = z.object({ sourceType: z.string().trim().max(100).optional().default("automation"), sourceId: z.string().trim().max(200).optional(), source: z.record(z.any()).optional().default({}) }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const rule = await prisma.projectControlRecord.findFirst({ where: { id: params.ruleId, projectId: project.id, kind: "automation", archived: false } });
    if (!rule) throw createHttpError("PROJECT_AUTOMATION_NOT_FOUND", "Project automation rule not found.", 404);
    return projectAutomation.executeRule(rule, { dryRun: true, context: { trigger: "manual_test", actorUserId: null, projectId: project.id, sourceType: body.sourceType, sourceId: body.sourceId || rule.id, source: { id: body.sourceId || rule.id, title: rule.title, ...body.source } } });
  });

  app.get("/api/projects/:projectId/automation-runs", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const query = z.object({ ruleId: z.string().optional(), limit: z.coerce.number().int().min(1).max(300).default(100) }).parse(request.query || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    return { projectId: project.id, runs: await projectAutomation.listRuns(project.id, query.ruleId, query.limit) };
  });

  app.post("/api/projects/:projectId/automation-runs/:runId/retry", async (request, reply) => {
    await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), runId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const run = await prisma.clusterPersistenceRecord.findFirst({ where: { id: params.runId, projectId: project.id, kind: "projectAutomationRun", archived: false } });
    if (!run) throw createHttpError("PROJECT_AUTOMATION_RUN_NOT_FOUND", "Project automation run not found.", 404);
    let payload: Record<string, any> = {};
    try { payload = JSON.parse(run.payload || "{}"); } catch { payload = {}; }
    if (!payload.ruleId || !payload.context) throw createHttpError("VALIDATION_FAILED", "This automation run does not contain retry context.", 400);
    const attempt = Number(payload.attempt || 1) + 1;
    const queued = await projectAutomation.enqueueRuleExecution(String(payload.ruleId), { context: payload.context, retryOf: run.id, actionsOverride: Array.isArray(payload.executionActions) ? payload.executionActions : undefined, skipConditions: Boolean(payload.deferredOf), deferredOf: payload.deferredOf || null, idempotencyKey: `${run.id}:manual-retry:${attempt}` });
    return { ok: true, queued: true, retryOf: run.id, ...queued };
  });

  app.post("/api/projects/:projectId/automations/evaluate-scheduled", async (request, reply) => {
    await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await projectAutomation.evaluateScheduled(project.id);
    return { ok: true, ...result };
  });

  app.post("/api/projects/:projectId/automations/evaluate-overdue", async (request, reply) => {
    await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    const result = await projectAutomation.evaluateOverdue(project.id);
    return { ok: true, ...result };
  });
}
