import { z } from "zod";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";
import { PeopleGovernanceError } from "../users/people-governance.js";
import { requireScopedGrantSubject, requireScopedGrantExtension, validateScopedGrantWindow } from "./scoped-grant-policy.js";

const createSchema = z.object({
  userId: z.string().min(1), projectId: z.string().min(1),
  operation: z.enum(["grant", "extend"]), accessRuleId: z.string().min(1).optional(),
  level: z.enum(["view", "contribute", "manage"]),
  expiresAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(12).max(2000),
  expectedProfileRevision: z.number().int().positive(),
}).strict();
const reviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(8).max(2000) }).strict();
const projectInclude = { memberships: { where: { status: "active" } } };
const view = (row: any) => ({
  id: row.id, userId: row.subjectUserId, targetKind: row.targetKind, targetId: row.targetId,
  operation: row.operation, accessRuleId: row.accessRuleId, grantedRuleId: row.grantedRuleId,
  level: row.level, expiresAt: row.expiresAt, previousExpiresAt: row.previousExpiresAt,
  status: row.status, requestedById: row.requestedById, reviewedById: row.reviewedById,
  reason: row.reason, reviewReason: row.reviewReason, requestedAt: row.requestedAt,
  reviewedAt: row.reviewedAt, personnelRecordId: row.personnelRecordId,
});
function activeProject(project: any) {
  if (!project || ["archived", "cancelled", "completed", "deleted"].includes(String(project.status || "").toLowerCase()))
    throw new PeopleGovernanceError("SCOPED_GRANT_PROJECT_UNAVAILABLE", "This Project no longer accepts access grants.", 409);
  return project;
}
async function lockGrant(tx: any, projectId: string, userId: string) {
  await acquireTransactionAdvisoryLock(tx, `cluster-scoped-grant:project:${projectId}:${userId}`);
}
async function subjectInProjectWorkspace(tx: any, user: any, project: any, now: Date) {
  requireScopedGrantSubject(user, now);
  const membership = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: user.id } } });
  if (!membership) throw new PeopleGovernanceError("SCOPED_GRANT_WORKSPACE", "Recipient is not a member of the Project's studio workspace.", 409);
}
async function findLiveDirectRules(tx: any, projectId: string, userId: string, now: Date) {
  return tx.accessRule.findMany({ where: {
    targetKind: "project", targetId: projectId, subjectKind: "member", subjectId: userId,
    effect: "allow", status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  } });
}
export function registerScopedGrantRoutes({ app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent }: any) {
  async function manager(request: any, reply: any) { return authorization.requireTool(request, reply, "people", "manage"); }
  async function managedProject(request: any, reply: any, projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, include: projectInclude });
    if (!project) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND" }); return null; }
    if (!(await authorization.requireTarget(request, reply, "project", projectId, project, "manage"))) return null;
    if (["archived", "cancelled", "completed", "deleted"].includes(String(project.status || "").toLowerCase())) { reply.code(409).send({ ok: false, code: "SCOPED_GRANT_PROJECT_UNAVAILABLE" }); return null; }
    return project;
  }
  async function execute(reply: any, fn: () => Promise<unknown>) {
    try { return await fn(); }
    catch (error) {
      if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  }
  app.get("/api/studio-systems/scoped-grants", async (request: any, reply: any) => {
    reply.header("Cache-Control", "private, no-store");
    if (!(await manager(request, reply))) return;
    // Explicit bounded lists. Do not silently claim a full roster when truncated.
    const [requests, people, projects] = await Promise.all([
      prisma.studioScopedGrantRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 150 }),
      prisma.user.findMany({ where: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] }, select: { id: true, username: true, displayName: true, accessExpiresAt: true, profileRevision: true }, orderBy: { username: "asc" }, take: 251 }),
      prisma.project.findMany({ where: { status: { notIn: ["archived", "cancelled", "deleted"] } }, include: projectInclude, orderBy: { name: "asc" }, take: 251 }),
    ]);
    const allowedProjects = [];
    for (const project of projects.slice(0, 250)) {
      const decision = await authorization.authorize(request, "manage", { kind: "project", project }, { minimum: "manage" });
      if (decision.allowed) allowedProjects.push({ id: project.id, name: project.name });
    }
    const projectIds = allowedProjects.map((project) => project.id);
    const grants = projectIds.length ? await prisma.accessRule.findMany({ where: {
      targetKind: "project", targetId: { in: projectIds }, subjectKind: "member", effect: "allow", status: "active",
      expiresAt: { gt: new Date() },
    }, orderBy: { updatedAt: "desc" }, take: 251 }) : [];
    return { requests: requests.filter((row: any) => projectIds.includes(row.targetId)).map(view), people: people.slice(0, 250), projects: allowedProjects,
      grants: grants.slice(0, 250).map((grant: any) => ({ id: grant.id, targetId: grant.targetId, subjectId: grant.subjectId, level: grant.level, expiresAt: grant.expiresAt })),
      truncated: { people: people.length > 250, projects: projects.length > 250, requests: requests.length === 150, grants: grants.length > 250 } };
  });
  app.post("/api/studio-systems/scoped-grants", async (request: any, reply: any) => {
    if (!(await manager(request, reply))) return;
    const body = createSchema.parse(request.body || {});
    const project = await managedProject(request, reply, body.projectId);
    if (!project) return;
    const actor = await getCurrentUser(request);
    return execute(reply, async () => {
      const row = await prisma.$transaction(async (tx: any) => {
        await lockGrant(tx, body.projectId, body.userId);
        const now = new Date();
        const subject = await tx.user.findUnique({ where: { id: body.userId } });
        await subjectInProjectWorkspace(tx, subject, activeProject(await tx.project.findUnique({ where: { id: body.projectId } })), now);
        if (subject.profileRevision !== body.expectedProfileRevision) throw new PeopleGovernanceError("SCOPED_GRANT_STALE", "Recipient profile changed; refresh before requesting.", 409);
        const expiresAt = new Date(body.expiresAt);
        validateScopedGrantWindow(subject, expiresAt, now);
        const pending = await tx.studioScopedGrantRequest.findFirst({ where: { subjectUserId: body.userId, targetKind: "project", targetId: body.projectId, status: "pending" } });
        if (pending) throw new PeopleGovernanceError("SCOPED_GRANT_PENDING", "There is already a pending request for this person and Project.", 409);
        const active = await findLiveDirectRules(tx, body.projectId, body.userId, now);
        let oldRule = null;
        if (body.operation === "grant") {
          if (body.accessRuleId || active.length) throw new PeopleGovernanceError("SCOPED_GRANT_ALREADY_EXISTS", "Active direct access exists; request a bounded extension instead.", 409);
        } else {
          oldRule = active.find((r: any) => r.id === body.accessRuleId);
          if (!oldRule || active.length !== 1) throw new PeopleGovernanceError("SCOPED_GRANT_NOT_FOUND", "Choose the single active direct member grant for extension.", 409);
          requireScopedGrantExtension(oldRule, { targetId: body.projectId, subjectUserId: body.userId, accessRuleId: oldRule.id, level: body.level, previousExpiresAt: oldRule.expiresAt, expectedRuleUpdatedAt: oldRule.updatedAt, expiresAt }, now);
        }
        const admins = await tx.workspaceMember.findMany({ where: { workspaceId: project.workspaceId, role: { in: ["owner", "admin"] }, user: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] } }, select: { userId: true }, take: 251 });
        if (admins.length > 250) throw new PeopleGovernanceError("SCOPED_GRANT_REVIEWER_LIMIT", "Reviewer roster exceeds bounded notification delivery.", 409);
        const reviewers = [...new Set(admins.map((member: any) => member.userId))].filter((id) => id !== actor.id && id !== body.userId);
        if (!reviewers.length) throw new PeopleGovernanceError("SCOPED_GRANT_REVIEWER_REQUIRED", "A separate active Studio administrator is required.", 409);
        const created = await tx.studioScopedGrantRequest.create({ data: {
          subjectUserId: body.userId, requestedById: actor.id, targetId: body.projectId, targetKind: "project", workspaceId: project.workspaceId,
          operation: body.operation, accessRuleId: oldRule?.id || null, expectedRuleUpdatedAt: oldRule?.updatedAt || null,
          previousExpiresAt: oldRule?.expiresAt || null, level: body.level, expiresAt,
          expectedProfileRevision: subject.profileRevision, reason: body.reason,
        } });
        await tx.notificationInboxItem.createMany({ data: reviewers.map((userId) => ({ userId, category: "action", priority: "high", title: "Scoped Project grant needs review", message: `${subject.displayName || subject.username} · ${project.name} · ${body.level} until ${expiresAt.toISOString()}`, entityType: "project", entityId: project.id, resourceKind: "project", resourceId: project.id, groupKey: `scoped-grant:${created.id}`, tool: "people", signal: "scoped_grant_review", requiresAction: true })) });
        return created;
      });
      await logActivity?.({ userId: actor.id, entityType: "project", entityId: body.projectId, type: "scoped_grant_requested", title: "Scoped Project access requested", metadata: { grantRequestId: row.id } });
      return { ok: true, request: view(row) };
    });
  });
  app.post("/api/studio-systems/scoped-grants/:grantId/review", async (request: any, reply: any) => {
    if (!(await manager(request, reply))) return;
    const { grantId } = z.object({ grantId: z.string().min(1) }).parse(request.params);
    const body = reviewSchema.parse(request.body || {});
    const candidate = await prisma.studioScopedGrantRequest.findUnique({ where: { id: grantId } });
    if (!candidate) return reply.code(404).send({ ok: false, code: "SCOPED_GRANT_NOT_FOUND" });
    // Both People and the current Project authorization must hold at review time.
    const project = await managedProject(request, reply, candidate.targetId);
    if (!project) return;
    const actor = await getCurrentUser(request);
    return execute(reply, async () => {
      const committed = await prisma.$transaction(async (tx: any) => {
        await lockGrant(tx, candidate.targetId, candidate.subjectUserId);
        const row = await tx.studioScopedGrantRequest.findUnique({ where: { id: grantId } });
        if (!row || row.status !== "pending") throw new PeopleGovernanceError("SCOPED_GRANT_ALREADY_REVIEWED", "This request has already been decided.", 409);
        if (row.requestedById === actor.id || row.subjectUserId === actor.id) throw new PeopleGovernanceError("SCOPED_GRANT_SEPARATION", "The requester and recipient cannot approve this grant.", 403);
        const liveProject = activeProject(await tx.project.findUnique({ where: { id: row.targetId } }));
        if (liveProject.workspaceId !== row.workspaceId) throw new PeopleGovernanceError("SCOPED_GRANT_PROJECT_CHANGED", "The Project moved workspaces.", 409);
        let grantedRuleId: string | null = null;
        if (body.decision === "approved") {
          const now = new Date();
          const subject = await tx.user.findUnique({ where: { id: row.subjectUserId } });
          await subjectInProjectWorkspace(tx, subject, liveProject, now);
          if (subject.profileRevision !== row.expectedProfileRevision) throw new PeopleGovernanceError("SCOPED_GRANT_STALE", "Recipient profile changed; request a new grant.", 409);
          validateScopedGrantWindow(subject, new Date(row.expiresAt), now);
          const active = await findLiveDirectRules(tx, row.targetId, row.subjectUserId, now);
          if (row.operation === "grant") {
            if (active.length) throw new PeopleGovernanceError("SCOPED_GRANT_STALE", "A direct allow grant was created after this request.", 409);
            const created = await tx.accessRule.create({ data: {
              targetKind: "project", targetId: row.targetId, projectId: row.targetId,
              subjectKind: "member", subjectId: row.subjectUserId, subjectName: String(subject.displayName || subject.username),
              effect: "allow", level: row.level, sections: "[]", status: "active", expiresAt: row.expiresAt,
              notes: `Governed grant request ${row.id}`, governedGrantId: row.id, createdById: actor.id,
            } });
            grantedRuleId = created.id;
          } else {
            const rule = active.find((r: any) => r.id === row.accessRuleId);
            if (!rule || active.length !== 1) throw new PeopleGovernanceError("SCOPED_GRANT_STALE", "Existing grant changed or expired.", 409);
            requireScopedGrantExtension(rule, row, now);
            const result = await tx.accessRule.updateMany({ where: { id: rule.id, updatedAt: row.expectedRuleUpdatedAt, status: "active", expiresAt: row.previousExpiresAt }, data: { expiresAt: row.expiresAt } });
            if (result.count !== 1) throw new PeopleGovernanceError("SCOPED_GRANT_STALE", "Grant changed concurrently.", 409);
            grantedRuleId = rule.id;
          }
        }
        const update = await tx.studioScopedGrantRequest.updateMany({ where: { id: row.id, status: "pending" }, data: { status: body.decision, reviewedById: actor.id, reviewReason: body.reason, reviewedAt: new Date(), grantedRuleId } });
        if (update.count !== 1) throw new PeopleGovernanceError("SCOPED_GRANT_ALREADY_REVIEWED", "This request was already processed.", 409);
        const record = await tx.personnelRecord.create({ data: {
          subjectUserId: row.subjectUserId, custodianUserId: actor.id, createdById: actor.id, lastModifiedById: actor.id,
          title: `Scoped Project access ${body.decision}`, recordType: "scoped_grant", sourceKind: "studio_scoped_grant", sourceId: row.id,
          classification: "confidential", disclosurePolicy: "internal_only", status: "finalized", finalizedAt: new Date(),
          fieldsJson: JSON.stringify({ operation: row.operation, projectId: row.targetId, ruleId: grantedRuleId, level: row.level, expiresAt: row.expiresAt, requesterId: row.requestedById, reviewerId: actor.id, reason: row.reason, reviewReason: body.reason, decision: body.decision, noIdentityRenewal: true }),
        } });
        await tx.studioScopedGrantRequest.update({ where: { id: row.id }, data: { personnelRecordId: record.id } });
        await tx.notificationInboxItem.updateMany({ where: { groupKey: `scoped-grant:${row.id}`, requiresAction: true }, data: { requiresAction: false, acknowledgedAt: new Date(), readAt: new Date() } });
        const recipients = await tx.user.findMany({ where: { id: { in: [row.requestedById, row.subjectUserId] }, archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] }, select: { id: true } });
        if (recipients.length) await tx.notificationInboxItem.createMany({ data: recipients.map((person: any) => ({ userId: person.id, category: "notification", priority: "normal", title: `Scoped access ${body.decision}`, message: "A scoped Project access decision is available in Studio Settings.", entityType: "project", entityId: row.targetId, resourceKind: "project", resourceId: row.targetId, groupKey: `scoped-grant-decision:${row.id}`, tool: "people", signal: "scoped_grant_decision", requiresAction: false })) });
        return { ...row, status: body.decision, reviewedById: actor.id, grantedRuleId, personnelRecordId: record.id };
      });
      await logSecurityEvent?.({ event: "account.scoped_grant_reviewed", actorUserId: actor.id, targetUserId: committed.subjectUserId, result: "SUCCESS", reasonCode: body.decision.toUpperCase(), request, metadata: { grantRequestId: committed.id, ruleId: committed.grantedRuleId } });
      await logActivity?.({ userId: actor.id, entityType: "project", entityId: committed.targetId, type: "scoped_grant_reviewed", title: `Scoped Project grant ${body.decision}`, metadata: { grantRequestId: committed.id } });
      return { ok: true, request: view(committed) };
    });
  });
}
