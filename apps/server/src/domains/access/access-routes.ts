import { z } from "zod";
import { validateClusterBundleAssignments, validateClusterPermissionBundles } from "@cluster/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { ACCESS_RULE_TARGET_KINDS, AUTHORIZATION_RULE_SELECT, type AuthorizationService } from "./authorization.js";
import { discoverProjectAccessTargets } from "./project-target-discovery.js";
import { previewProjectRuleImpact } from "./project-rule-preview.js";
import { PROJECT_ACCESS_PICKER_KINDS, type ProjectAccessPickerKind } from "./project-target-discovery.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../workforce/workforce-user-authority.js";

type AccessRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getStudioPermissionSettings: () => any;
  authorization: AuthorizationService;
  cursorSecret: string;
  canAccessLibraryItem: (request: FastifyRequest, item: any, minimum: "view" | "manage") => Promise<boolean>;
  serializeAccessRule: (rule: any) => any;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
};

type ResolvedTarget = { targetKind: string; targetId: string; project: any | null };

async function resolveTarget(prisma: any, targetKind: string, targetId: string): Promise<ResolvedTarget | null> {
  if (targetKind === "project") {
    const project = await prisma.project.findUnique({ where: { id: targetId }, include: { memberships: { where: { status: "active" } } } });
    return project ? { targetKind, targetId, project } : null;
  }
  if (targetKind === "board") {
    const board = await prisma.board.findUnique({ where: { id: targetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    return board ? { targetKind, targetId, project: board.project } : null;
  }
  if (targetKind === "whiteboard") {
    const whiteboard = await prisma.whiteboard.findUnique({ where: { id: targetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    return whiteboard ? { targetKind, targetId, project: whiteboard.project || null } : null;
  }
  if (targetKind === "review_asset") {
    const video = await prisma.reviewAsset.findUnique({ where: { id: targetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    return video ? { targetKind, targetId, project: video.project } : null;
  }
  if (targetKind === "file") {
    const file = await prisma.projectFile.findUnique({ where: { id: targetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    return file ? { targetKind, targetId, project: file.project } : null;
  }
  if (targetKind === "library") {
    const item = await prisma.libraryItem.findUnique({ where: { id: targetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    return item ? { targetKind, targetId, project: item.project || null } : null;
  }
  return null;
}

async function requireManageTarget(
  deps: AccessRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
  targetKind: string,
  targetId: string,
  projectIdHint?: string | null,
) {
  const resolved = await resolveTarget(deps.prisma, targetKind, targetId);
  if (!resolved) {
    reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access target not found." });
    return null;
  }
  if (projectIdHint && resolved.project?.id !== projectIdHint) {
    reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access target not found in that project." });
    return null;
  }
  if (!(await deps.authorization.requireTarget(request, reply, targetKind, targetId, resolved.project, "manage"))) return null;
  // The canonical Library source/folder ACL is independent of Project Access
  // Rules. Managing a Project must not grant control over its restricted files.
  if (targetKind === "library") {
    const item = await deps.prisma.libraryItem.findUnique({ where: { id: targetId }, include: { project: true } });
    if (!item || !(await deps.canAccessLibraryItem(request, item, "manage"))) {
      reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access target not found in this scope." });
      return null;
    }
  }
  return resolved;
}

async function resolveAccessSubject(prisma: any, subjectKind: "member" | "team" | "external" | "all", rawSubjectId: string | null | undefined, workspaceId?: string | null) {
  if (subjectKind === "all") return { subjectId: null, subjectName: "Everyone" };
  if (subjectKind === "external") return { subjectId: null, subjectName: "External collaborators" };

  const subjectId = String(rawSubjectId || "").trim();
  if (!subjectId) return null;
  if (subjectKind === "member") {
    const user = await prisma.user.findUnique({ where: { id: subjectId }, select: { id: true, username: true, displayName: true, archived: true, accountState: true } });
    if (!user || user.archived || String(user.accountState || "").toUpperCase() === "PRIVACY_ERASED") return null;
    if (workspaceId) {
      const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, select: { id: true } });
      if (!membership) return null;
    }
    return { subjectId: user.id, subjectName: String(user.displayName || user.username || user.id) };
  }

  const team = await prisma.studioTeam.findUnique({ where: { id: subjectId }, select: { id: true, name: true, workspaceId: true, archived: true } });
  if (!team || team.archived || (workspaceId && team.workspaceId !== workspaceId)) return null;
  return { subjectId: team.id, subjectName: team.name };
}

export function registerAccessRoutes(deps: AccessRouteDependencies) {
  const { app, prisma, getCurrentUser, authorization, serializeAccessRule, logActivity } = deps;

  // This is a discovery projection, NOT a permission grant. It is restricted to
  // a project that the request actor may access, and every candidate is checked
  // against the current canonical target rules before a name leaves the server.
  // Admin-only, read-only dry run. Never writes Settings or AccessRule records.
  // Preview values are supplied by the editor and are not adopted as live policy.
  app.post("/api/access/permission-preview", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!(await authorization.requireAdmin(request, reply))) return;
    const body = z.object({
      roleId: z.string().min(1).max(64),
      departmentId: z.string().max(64).nullable().optional(),
      studioPermissionBundles: z.unknown().optional(),
      studioRoleDefinitions: z.array(z.record(z.string(), z.unknown())).max(256).optional(),
      studioDepartmentDefinitions: z.array(z.record(z.string(), z.unknown())).max(256).optional(),
    }).strict().parse(request.body || {});
    const existing = deps.getStudioPermissionSettings() || {};
    const proposal = {
      ...existing,
      ...(body.studioPermissionBundles !== undefined ? { studioPermissionBundles: body.studioPermissionBundles } : {}),
      ...(body.studioRoleDefinitions !== undefined ? { studioRoleDefinitions: body.studioRoleDefinitions } : {}),
      ...(body.studioDepartmentDefinitions !== undefined ? { studioDepartmentDefinitions: body.studioDepartmentDefinitions } : {}),
    };
    try {
      const bundles = validateClusterPermissionBundles(proposal.studioPermissionBundles || []);
      for (const [kind, records] of [["Role", proposal.studioRoleDefinitions || []], ["Department", proposal.studioDepartmentDefinitions || []]] as const) {
        for (const record of records) validateClusterBundleAssignments(record.permissionBundleIds, bundles, `${kind} ${record.id || "unknown"}`);
      }
      const before = authorization.previewToolPermissionMatrix(body.roleId, body.departmentId || null, existing);
      const after = authorization.previewToolPermissionMatrix(body.roleId, body.departmentId || null, proposal);
      return { ok: true, roleId: body.roleId, departmentId: body.departmentId || null,
        // Do not return raw settings, only effective levels and provenance.
        changes: Object.entries(after).map(([tool, proposed]) => ({ tool, current: (before as any)[tool], proposed })).filter((item) => item.current.level !== item.proposed.level || item.current.provenance?.effective?.sourceId !== item.proposed.provenance?.effective?.sourceId),
        matrix: after,
      };
    } catch (error) {
      return reply.code(400).send({ ok: false, code: "PERMISSION_BUNDLE_INVALID", error: error instanceof Error ? error.message : "Invalid permission preview." });
    }
  });

  // Preview, never mutate. Checks the same manager/target boundary as rule writes.
  // No names or per-user access decisions are exposed in the response.
  app.post("/api/access/rule-impact-preview", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const body = z.object({
      projectId: z.string().min(1).max(128),
      targetKind: z.enum(ACCESS_RULE_TARGET_KINDS),
      targetId: z.string().min(1).max(128),
      subjectKind: z.enum(["member", "team", "external", "all"]),
      subjectId: z.string().max(128).nullable().optional(),
      effect: z.enum(["allow", "deny"]),
      level: z.enum(["none", "view", "contribute", "manage"]),
      expiresAt: z.string().datetime().nullable().optional(),
    }).strict().parse(request.body || {});
    const resolved = await requireManageTarget(deps, request, reply, body.targetKind, body.targetId, body.projectId);
    if (!resolved?.project) return;
    const subject = await resolveAccessSubject(prisma, body.subjectKind, body.subjectId, resolved.project.workspaceId);
    if (!subject) return reply.code(400).send({ ok: false, code: "ACCESS_SUBJECT_INVALID", error: "Select an available workspace member or team." });
    return previewProjectRuleImpact({
      prisma, authorization, project: resolved.project, targetKind: body.targetKind, targetId: body.targetId,
      subjectKind: body.subjectKind, subjectId: subject.subjectId,
      effect: body.effect, level: body.effect === "deny" ? "none" : body.level,
      expiresAt: body.expiresAt || null,
    });
  });

  app.get("/api/access/targets", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const query = z.object({
      projectId: z.string().min(1).max(128),
      q: z.string().trim().max(100).optional().default(""),
      minimum: z.enum(["view", "manage"]).optional().default("view"),
      limit: z.coerce.number().int().min(1).max(100).optional().default(80),
      cursor: z.string().min(1).max(2048).optional(),
      kinds: z.string().min(1).max(100).optional(),
    }).strict().parse(request.query || {});
    const requestedKinds = query.kinds ? query.kinds.split(",") : [...PROJECT_ACCESS_PICKER_KINDS];
    if (!requestedKinds.length || new Set(requestedKinds).size !== requestedKinds.length || requestedKinds.some((kind) => !PROJECT_ACCESS_PICKER_KINDS.includes(kind as ProjectAccessPickerKind))) {
      return reply.code(400).send({ ok: false, code: "INVALID_PICKER_KINDS", error: "Select supported resource types." });
    }
    const project = await authorization.requireProject(request, reply, query.projectId, query.minimum);
    if (!project) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    try { return await discoverProjectAccessTargets({
      prisma, authorization, request, actorId: actor.id, cursorSecret: deps.cursorSecret, project, ...query, kinds: requestedKinds as ProjectAccessPickerKind[],
      canAccessLibraryItem: deps.canAccessLibraryItem,
      ruleSelect: AUTHORIZATION_RULE_SELECT,
    }); } catch (error) {
      if (error instanceof Error && error.message === "INVALID_PICKER_CURSOR") return reply.code(400).send({ ok: false, code: "INVALID_PICKER_CURSOR", error: "Resource list changed. Search again." });
      throw error;
    }
  });

  app.get("/api/access/explain", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const query = z.object({
      userId: z.string().min(1).optional(),
      action: z.enum(["view", "contribute", "manage", "subscribe", "disclose-private"]).optional().default("view"),
      tool: z.string().min(1).max(64).optional(),
      projectId: z.string().min(1).optional(),
      targetKind: z.enum(ACCESS_RULE_TARGET_KINDS).optional(),
      targetId: z.string().min(1).optional(),
    }).refine((value) => Boolean(value.tool || value.projectId || (value.targetKind && value.targetId)), { message: "Choose a tool, project, or target to explain." }).parse(request.query);

    const subject = query.userId && query.userId !== actor.id
      ? await prisma.user.findUnique({ where: { id: query.userId }, include: WORKFORCE_USER_AUTHORITY_INCLUDE })
      : actor;
    if (!subject) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "User not found." });
    if (subject.id !== actor.id) {
      const inspectDecision = await authorization.authorize(request, "disclose-private", { kind: "user", ownerUserId: subject.id, tool: "people" }, { minimum: "manage" });
      if (!inspectDecision.allowed) { authorization.sendDecision(reply, inspectDecision); return; }
    }

    const subjectActor = { user: subject };
    const result: Record<string, unknown> = { ok: true, actorUserId: actor.id, subjectUserId: subject.id, action: query.action };
    if (query.tool) result.tool = await authorization.authorize(subjectActor, query.action, { kind: "tool", tool: query.tool }, { minimum: query.action === "manage" ? "manage" : query.action === "contribute" ? "edit" : "view" });

    // An Access Explorer preview must not bypass the actor's own visibility.
    // Only after checking the actor can we explain somebody else's access.
    const project = query.projectId ? await authorization.requireProject(request, reply, query.projectId, "view") : null;
    if (query.projectId && !project) return;
    if (project) result.project = await authorization.authorize(subjectActor, query.action, { kind: "project", project }, { minimum: query.action === "manage" ? "manage" : query.action === "contribute" ? "contribute" : "view" });

    if (query.targetKind && query.targetId) {
      const resolved = await resolveTarget(prisma, query.targetKind, query.targetId);
      if (!resolved || (project && resolved.project?.id !== project.id)) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access target not found in this scope." });
      const actorDecision = await authorization.authorize(request, "view", { kind: "target", targetKind: query.targetKind, targetId: query.targetId, project: resolved.project }, { minimum: "view", surface: "api" });
      if (!actorDecision.allowed) { authorization.sendDecision(reply, actorDecision); return; }
      if (query.targetKind === "library") {
        const item = await prisma.libraryItem.findUnique({ where: { id: query.targetId }, include: { project: true } });
        if (!item || !(await deps.canAccessLibraryItem(request, item, "view"))) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access target not found in this scope." });
      }
      // Explain the global Tool layer independently. It is a prerequisite, not
      // an alternate target grant. Actual target authorization remains canonical.
      const targetTool = authorization.targetTool(query.targetKind);
      if (targetTool) {
        result.toolKey = targetTool;
        result.tool = await authorization.authorize(subjectActor, query.action, { kind: "tool", tool: targetTool }, { minimum: query.action === "manage" ? "manage" : query.action === "contribute" ? "edit" : "view" });
      }
      result.target = await authorization.authorize(subjectActor, query.action, { kind: "target", targetKind: query.targetKind, targetId: query.targetId, project: resolved.project }, { minimum: query.action === "manage" ? "manage" : query.action === "contribute" ? "contribute" : "view" });
    }
    return result;
  });

  app.get("/api/access-rules", async (request, reply) => {
    const query = z.object({
      projectId: z.string().optional(),
      targetKind: z.enum(ACCESS_RULE_TARGET_KINDS).optional(),
      targetId: z.string().optional(),
    }).parse(request.query);

    if (query.targetKind && query.targetId) {
      if (!(await requireManageTarget(deps, request, reply, query.targetKind, query.targetId, query.projectId))) return;
    } else if (query.projectId) {
      if (!(await authorization.requireProject(request, reply, query.projectId, "manage"))) return;
    } else if (!(await authorization.requireAdmin(request, reply))) {
      return;
    }

    const where: any = { status: { not: "archived" } };
    if (query.projectId) where.OR = [{ projectId: query.projectId }, { targetId: query.projectId, targetKind: "project" }];
    if (query.targetKind) where.targetKind = query.targetKind;
    if (query.targetId) where.targetId = query.targetId;
    const rows = await prisma.accessRule.findMany({ where, orderBy: { updatedAt: "desc" } });
    return rows.map(serializeAccessRule);
  });

  app.post("/api/access-rules", async (request, reply) => {
    const user = await getCurrentUser(request);
    const body = z.object({
      targetKind: z.enum(ACCESS_RULE_TARGET_KINDS),
      targetId: z.string().min(1),
      projectId: z.string().optional().nullable(),
      subjectKind: z.enum(["member", "team", "external", "all"]),
      subjectId: z.string().optional().nullable(),
      effect: z.enum(["allow", "deny"]).optional().default("allow"),
      level: z.enum(["none", "view", "contribute", "manage"]).optional().default("view"),
      sections: z.array(z.string()).optional().default([]),
      status: z.enum(["active", "paused", "archived"]).optional().default("active"),
      expiresAt: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(request.body);

    // F10: member allow grants must be independently reviewed. Paused-rule creation
    // followed by PATCH is not a permitted shortcut around the approval ledger.
    if (body.subjectKind === "member" && body.effect === "allow") return reply.code(409).send({ ok: false, code: "SCOPED_GRANT_REVIEW_REQUIRED", error: "Request individual allow access through Studio Systems → Scoped Grants." });
    const resolved = await requireManageTarget(deps, request, reply, body.targetKind, body.targetId, body.projectId);
    if (!resolved) return;
    const subject = await resolveAccessSubject(prisma, body.subjectKind, body.subjectId, resolved.project?.workspaceId || null);
    if (!subject) return reply.code(400).send({ ok: false, code: "ACCESS_SUBJECT_INVALID", error: "Access subject is missing, archived, unavailable, or outside this workspace." });
    const created = await prisma.accessRule.create({
      data: {
        targetKind: body.targetKind,
        targetId: body.targetId,
        projectId: resolved.project?.id || null,
        subjectKind: body.subjectKind,
        subjectId: subject.subjectId,
        subjectName: subject.subjectName,
        effect: body.effect,
        level: body.effect === "deny" ? "none" : body.level === "none" ? "view" : body.level,
        sections: JSON.stringify(body.sections || []),
        status: body.status,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        notes: body.notes || null,
        createdById: user?.id || null,
      },
    });
    await logActivity({
      userId: user?.id,
      projectId: resolved.project?.id || undefined,
      type: "access",
      entityType: body.targetKind,
      entityId: body.targetId,
      title: "Access rule created",
      message: `${body.effect === "deny" ? "Blocked" : "Allowed"} ${subject.subjectName} on ${body.targetKind}`,
    });
    return serializeAccessRule(created);
  });

  app.patch("/api/access-rules/:ruleId", async (request, reply) => {
    const params = z.object({ ruleId: z.string() }).parse(request.params);
    const body = z.object({
      effect: z.enum(["allow", "deny"]).optional(),
      level: z.enum(["none", "view", "contribute", "manage"]).optional(),
      sections: z.array(z.string()).optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
      expiresAt: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(request.body);
    const existingRule = await prisma.accessRule.findUnique({ where: { id: params.ruleId } });
    if (!existingRule) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access rule not found." });
    // Existing member allow rules may still be revoked, never elevated or
    // renewed directly. A deny→allow flip must not bypass review either.
    if (existingRule.subjectKind === "member" && (existingRule.effect === "allow" || body.effect === "allow") &&
        (existingRule.effect !== "allow" || Object.keys(body).some((key) => key !== "status" && key !== "notes") || (body.status && body.status !== "archived")))
      return reply.code(409).send({ ok: false, code: "SCOPED_GRANT_REVIEW_REQUIRED", error: "Individual allow grants require a scoped grant review; direct changes may only archive a grant." });
    const resolved = await requireManageTarget(deps, request, reply, existingRule.targetKind, existingRule.targetId, existingRule.projectId);
    if (!resolved) return;
    const data: any = { ...body };
    if (body.sections) data.sections = JSON.stringify(body.sections);
    if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    const nextEffect = body.effect ?? existingRule.effect;
    const requestedLevel = body.level ?? existingRule.level;
    data.level = nextEffect === "deny" ? "none" : requestedLevel === "none" ? "view" : requestedLevel;
    const actor = await getCurrentUser(request);
    const updated = await prisma.accessRule.update({ where: { id: params.ruleId }, data });
    await logActivity({
      userId: actor?.id,
      projectId: resolved.project?.id || undefined,
      type: "access",
      entityType: updated.targetKind,
      entityId: updated.targetId,
      title: body.status === "archived" ? "Access rule archived" : "Access rule updated",
      message: `${updated.subjectName} · ${updated.effect} ${updated.level}`,
    });
    return serializeAccessRule(updated);
  });

  app.delete("/api/access-rules/:ruleId", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ ruleId: z.string() }).parse(request.params);
    const existingRule = await prisma.accessRule.findUnique({ where: { id: params.ruleId } });
    if (!existingRule) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Access rule not found." });
    const resolved = await requireManageTarget(deps, request, reply, existingRule.targetKind, existingRule.targetId, existingRule.projectId);
    if (!resolved) return;
    const updated = await prisma.accessRule.update({ where: { id: params.ruleId }, data: { status: "archived" } });
    await logActivity({
      userId: actor?.id,
      projectId: resolved.project?.id || undefined,
      type: "access",
      entityType: updated.targetKind,
      entityId: updated.targetId,
      title: "Access rule archived",
      message: updated.subjectName,
    });
    return { ok: true };
  });
}
