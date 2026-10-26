import { z } from "zod";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";


function parseJson(value: unknown, fallback: any) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function connectionState(user: any, status: any, canSeePrivate: boolean) {
  if (!canSeePrivate && status?.connectionVisibility === "invisible") return "offline";
  const seen = user?.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
  const age = Math.max(0, Date.now() - seen);
  if (!seen || age > 5 * 60_000) return "offline";
  if (age > 90_000) return "idle";
  return "online";
}

function publicEmployment(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    departmentId: row.departmentId || null,
    department: row.department ? { id: row.department.id, name: row.department.name, color: row.department.color || null } : null,
    jobRoleId: row.jobRoleId || null,
    jobRole: row.jobRole ? { id: row.jobRole.id, name: row.jobRole.name } : null,
    managerUserId: row.managerUserId || null,
    manager: row.manager ? { id: row.manager.id, username: row.manager.username, displayName: row.manager.preferredName || row.manager.displayName || row.manager.username, avatarUrl: row.manager.avatarUrl || null } : null,
    employmentType: row.employmentType || null,
    workLocation: row.workLocation || null,
    startDate: row.startDate || null,
    endDate: row.endDate || null,
    capacityHours: row.capacityHours ?? null,
    minimumHours: row.minimumHours ?? null,
    active: Boolean(row.active),
    revision: Number(row.revision || 1),
  };
}

export function registerWorkforceRoutes(deps: any) {
  const { app, prisma, authorization, getCurrentUser, decorateUserForClient, serializeUserPublicProfile, logActivity } = deps;

  async function actorFor(request: any, reply: any, level: "view" | "edit" | "manage" = "view") {
    if (!(await authorization.requireTool(request, reply, "people", level))) return null;
    const identity = await authorization.identityForRequest(request);
    return identity.user ? identity : null;
  }

  async function canManageAvailabilityFor(request: any, actor: any, targetUserId: string) {
    if (String(actor.id) === String(targetUserId)) return true;
    // Manage/edit People permissions cannot cross the workspace boundary by
    // merely providing a different target person's ID. This also constrains
    // the direct-manager exception below.
    const memberships = await prisma.workspaceMember.findMany({ where: { userId: actor.id }, select: { workspaceId: true } });
    const workspaceIds = memberships.map((row: any) => row.workspaceId);
    if (!workspaceIds.length) return false;
    const sharedMembership = await prisma.workspaceMember.findFirst({ where: { userId: targetUserId, workspaceId: { in: workspaceIds } }, select: { id: true } });
    if (!sharedMembership) return false;
    const identity = await authorization.identityForRequest(request);
    if (identity?.user && (identity.decorated?.isAdmin || authorization.hasToolPermission(identity.user, identity.role, "people", "edit"))) return true;
    const employment = await prisma.employment.findUnique({ where: { userId: targetUserId }, select: { managerUserId: true, active: true } });
    return Boolean(employment?.active && String(employment.managerUserId || "") === String(actor.id));
  }

  app.get("/api/workforce/context", async (request: any, reply: any) => {
    const identity = await actorFor(request, reply, "view"); if (!identity?.user) return;
    const query = z.object({ userId: z.string().trim().min(1).optional(), includeArchived: z.preprocess((value) => value === true || value === "true", z.boolean()).optional().default(false) }).parse(request.query || {});
    const workspaceMembership = await prisma.workspaceMember.findFirst({ where: { userId: identity.user.id }, orderBy: { workspaceId: "asc" } });
    if (!workspaceMembership) return { generatedAt: new Date().toISOString(), departments: [], jobRoles: [], skills: [], teams: [], people: [], projectMemberships: [] };
    const workspaceId = workspaceMembership.workspaceId;
    // A People tool permission is not permission to enumerate other studio
    // workspaces. Scope every related projection through workspace membership.
    const mayInspectArchived = Boolean(identity.decorated?.isAdmin || authorization.hasToolPermission(identity.user, identity.role, "people", "manage"));
    if (query.includeArchived && !mayInspectArchived) return reply.code(403).send({ ok: false, code: "WORKFORCE_ARCHIVED_DENIED", error: "Archived people require management access." });
    const userWhere: any = { memberships: { some: { workspaceId } }, ...(query.includeArchived ? {} : { archived: false }), ...(query.userId ? { id: query.userId } : {}) };
    const [departments, jobRoles, skills, teams, users, projectMemberships, activeTimers, exceptions] = await Promise.all([
      prisma.department.findMany({ where: { workspaceId, ...(query.includeArchived ? {} : { archived: false }) }, include: { _count: { select: { employments: true, teams: true } } }, orderBy: { name: "asc" }, take: 500 }),
      prisma.jobRole.findMany({ where: { workspaceId, ...(query.includeArchived ? {} : { archived: false }) }, include: { department: true, _count: { select: { employments: true } } }, orderBy: { name: "asc" }, take: 500 }),
      prisma.skill.findMany({ where: { workspaceId, ...(query.includeArchived ? {} : { archived: false }) }, include: { _count: { select: { people: true } } }, orderBy: { name: "asc" }, take: 1000 }),
      prisma.studioTeam.findMany({ where: { workspaceId, ...(query.includeArchived ? {} : { archived: false }) }, include: { departmentAuthority: true, leadUser: true, roles: { where: query.includeArchived ? {} : { archived: false }, orderBy: { name: "asc" } }, members: { where: query.includeArchived ? {} : { archived: false }, include: { teamRole: true, user: true }, orderBy: [{ primaryMembership: "desc" }, { createdAt: "asc" }] } }, orderBy: { name: "asc" }, take: 500 }),
      prisma.user.findMany({ where: userWhere, include: { memberships: true, employment: { include: { department: true, jobRole: true, manager: true } }, workforceStatus: true, presenceContext: true, workingPattern: true, personSkills: { include: { skill: true }, orderBy: [{ primary: "desc" }, { updatedAt: "desc" }] }, studioTeamMemberships: { where: { archived: false }, include: { team: true, teamRole: true } } }, orderBy: [{ displayName: "asc" }, { username: "asc" }], take: 2000 }),
      prisma.projectMembership.findMany({ where: { status: "active", project: { workspaceId }, user: { is: userWhere } }, include: { project: { select: { id: true, name: true, status: true, archived: true, source: true } } }, orderBy: { updatedAt: "desc" }, take: 10000 }),
      prisma.timeEntry.findMany({ where: { endedAt: null, user: { is: userWhere } }, select: { id: true, userId: true, projectId: true, title: true, startedAt: true, breaks: { where: { endedAt: null }, select: { id: true }, take: 1 } }, orderBy: { startedAt: "desc" }, take: 2000 }),
      prisma.availabilityException.findMany({ where: { user: { is: userWhere }, status: { not: "cancelled" }, endsAt: { gte: new Date(Date.now() - 86400000) }, startsAt: { lte: new Date(Date.now() + 180 * 86400000) } }, orderBy: { startsAt: "asc" }, take: 10000 }),
    ]);
    const visibleMemberships: any[] = [];
    for (const membership of projectMemberships) {
      if (!membership.project || membership.project.archived) continue;
      const decision = await authorization.authorize({ user: identity.user, decorated: identity.decorated, role: identity.role }, "view", { kind: "project", project: membership.project }, { minimum: "view", surface: "api", tool: "projects" });
      if (decision.allowed) visibleMemberships.push(membership);
    }
    const visibleUserIds = new Set(users.map((row: any) => String(row.id)));
    const workspaceTeamIds = new Set(teams.map((row: any) => String(row.id)));
    const timerByUser = new Map(activeTimers.map((row: any) => [String(row.userId), row]));
    const exceptionsByUser = new Map<string, any[]>();
    for (const row of exceptions) { const bucket = exceptionsByUser.get(String(row.userId)) || []; bucket.push(row); exceptionsByUser.set(String(row.userId), bucket); }
    const projectByUser = new Map<string, any[]>();
    for (const row of visibleMemberships) { const bucket = projectByUser.get(String(row.userId)) || []; bucket.push(row); projectByUser.set(String(row.userId), bucket); }
    const people = users.map((user: any) => {
      const self = String(identity.user.id) === String(user.id);
      const privatePresence = Boolean(self || identity.decorated?.isAdmin || authorization.hasToolPermission(identity.user, identity.role, "people", "manage"));
      const status = user.workforceStatus || { availability: "available", connectionVisibility: "visible", availabilityMessage: null, presenceDisclosure: "work_state" };
      const invisibleMasked = status.connectionVisibility === "invisible" && !privatePresence;
      const disclosureOrder = ["connection", "work_state", "application", "project", "detailed"];
      const disclosureRank = Math.max(0, disclosureOrder.indexOf(String(status.presenceDisclosure || "work_state")));
      const rawContext = user.presenceContext && (!user.presenceContext.expiresAt || new Date(user.presenceContext.expiresAt).getTime() > Date.now()) ? user.presenceContext : null;
      const contextRestricted = String(rawContext?.sensitivity || "normal") === "restricted";
      const workContext = !invisibleMasked && rawContext && disclosureRank >= 2 ? {
        applicationKey: rawContext.applicationKey || null,
        projectId: disclosureRank >= 3 ? rawContext.projectId || null : null,
        repositoryId: !contextRestricted && disclosureRank >= 4 ? rawContext.repositoryId || null : null,
        branch: !contextRestricted && disclosureRank >= 4 ? rawContext.branch || null : null,
        resourceKind: !contextRestricted && disclosureRank >= 4 ? rawContext.resourceKind || null : null,
        resourceId: !contextRestricted && disclosureRank >= 4 ? rawContext.resourceId || null : null,
        sensitivity: contextRestricted ? "restricted" : "normal",
      } : null;
      return {
        ...serializeUserPublicProfile(user),
        employment: (() => {
          const employment = publicEmployment(user.employment);
          if (employment?.managerUserId && !visibleUserIds.has(String(employment.managerUserId))) {
            employment.managerUserId = null;
            employment.manager = null;
          }
          return employment;
        })(),
        workingPattern: user.workingPattern ? { timezone: user.workingPattern.timezone || null, hours: parseJson(user.workingPattern.hoursJson, {}), revision: Number(user.workingPattern.revision || 1) } : null,
        skills: (user.personSkills || []).map((row: any) => ({ id: row.skill.id, name: row.skill.name, level: row.level, years: row.years ?? null, primary: Boolean(row.primary) })),
        availability: invisibleMasked ? "offline" : disclosureRank >= 1 ? status.availability || "available" : undefined,
        availabilityMessage: invisibleMasked || disclosureRank < 1 ? null : status.availabilityMessage || null,
        declaredStatus: invisibleMasked || disclosureRank < 1 ? null : status.declaredStatus || null,
        presenceDisclosure: privatePresence ? status.presenceDisclosure || "work_state" : undefined,
        connectionState: connectionState(user, status, privatePresence),
        connectionVisibility: privatePresence ? status.connectionVisibility || "visible" : undefined,
        clockState: invisibleMasked || disclosureRank < 1 ? "unknown" : timerByUser.has(String(user.id)) ? ((timerByUser.get(String(user.id)) as any)?.breaks?.length ? "break" : "clocked_in") : "clocked_out",
        activeTimer: privatePresence ? timerByUser.get(String(user.id)) || null : undefined,
        workContext,
        teams: (user.studioTeamMemberships || []).filter((row: any) => workspaceTeamIds.has(String(row.teamId))).map((row: any) => ({ id: row.teamId, name: row.team?.name || "Team", roleId: row.teamRoleId || null, role: row.teamRole?.name || row.roleLabel || null, allocationPercent: Number(row.allocationPercent || 0), primary: Boolean(row.primaryMembership) })),
        projectMemberships: (projectByUser.get(String(user.id)) || []).map((row: any) => ({ id: row.id, projectId: row.projectId, projectName: row.project?.name || "Project", roleKey: row.roleKey || null, roleLabel: row.roleLabel || null, allocationPercent: Number(row.allocationPercent || 0), accessLevel: row.accessLevel, isLead: Boolean(row.isLead), status: row.status })),
        availabilityExceptions: (exceptionsByUser.get(String(user.id)) || []).map((row: any) => {
          const managerCanSeeReason = String(user.employment?.managerUserId || "") === String(identity.user.id);
          const canSeeReason = Boolean(privatePresence || managerCanSeeReason);
          return { id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, kind: row.kind, status: row.status, reason: canSeeReason ? row.reason || null : null, reasonRestricted: Boolean(row.reason && !canSeeReason), source: row.source };
        }),
      };
    });
    return {
      generatedAt: new Date().toISOString(), workspaceId,
      departments: departments.map((row: any) => ({ id: row.id, name: row.name, description: row.description || null, parentId: row.parentId || null, leadUserId: row.leadUserId || null, color: row.color || null, archived: Boolean(row.archived), members: Number(row._count?.employments || 0), teams: Number(row._count?.teams || 0), revision: Number(row.revision || 1) })),
      jobRoles: jobRoles.map((row: any) => ({ id: row.id, name: row.name, description: row.description || null, departmentId: row.departmentId || null, departmentName: row.department?.name || null, defaultCapacityHours: row.defaultCapacityHours ?? null, defaultMinimumHours: row.defaultMinimumHours ?? null, members: Number(row._count?.employments || 0), archived: Boolean(row.archived), revision: Number(row.revision || 1) })),
      skills: skills.map((row: any) => ({ id: row.id, name: row.name, description: row.description || null, people: Number(row._count?.people || 0), archived: Boolean(row.archived) })),
      teams: teams.map((team: any) => ({ id: team.id, name: team.name, description: team.description || null, departmentId: team.departmentId || null, department: team.departmentAuthority ? { id: team.departmentAuthority.id, name: team.departmentAuthority.name } : null, leadUserId: team.leadUserId || null, roles: team.roles.map((role: any) => ({ id: role.id, name: role.name, description: role.description || null })), members: team.members.map((member: any) => ({ userId: member.userId, roleId: member.teamRoleId || null, role: member.teamRole?.name || member.roleLabel || null, allocationPercent: Number(member.allocationPercent || 0), primary: Boolean(member.primaryMembership) })), archived: Boolean(team.archived), revision: Number(team.revision || 1) })),
      people,
      capacity: { configuredPeople: people.filter((person: any) => person.employment?.capacityHours != null).length, totalHours: people.reduce((sum: number, person: any) => sum + Number(person.employment?.capacityHours ?? 0), 0), clockedIn: people.filter((person: any) => person.clockState === "clocked_in").length, available: people.filter((person: any) => person.availability === "available").length },
    };
  });

  app.post("/api/workforce/availability-exceptions", async (request: any, reply: any) => {
    const user = await getCurrentUser(request); if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ userId: z.string().min(1).optional(), startsAt: z.coerce.date(), endsAt: z.coerce.date(), kind: z.enum(["unavailable", "limited", "preferred", "time_off"]).default("unavailable"), reason: z.string().trim().max(500).nullable().optional(), source: z.string().trim().max(60).default("manual") }).parse(request.body || {});
    const targetUserId = body.userId || user.id;
    if (!(await canManageAvailabilityFor(request, user, targetUserId))) return reply.code(403).send({ ok: false, code: "AVAILABILITY_ACCESS_DENIED", error: "You may only manage your own availability or the availability of a direct report." });
    if (body.endsAt <= body.startsAt) return reply.code(400).send({ ok: false, code: "AVAILABILITY_RANGE_INVALID", error: "Availability end must be after start." });
    const row = await prisma.availabilityException.create({ data: { userId: targetUserId, startsAt: body.startsAt, endsAt: body.endsAt, kind: body.kind, reason: body.reason || null, source: body.source, status: "confirmed" } });
    await logActivity?.({ userId: user.id, type: "workforce", entityType: "availability_exception", entityId: row.id, title: "Availability window added", message: body.kind, metadata: { targetUserId, startsAt: row.startsAt, endsAt: row.endsAt, source: row.source } });
    return reply.code(201).send({ ok: true, exception: row });
  });

  app.delete("/api/workforce/availability-exceptions/:id", async (request: any, reply: any) => {
    const user = await getCurrentUser(request); if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const row = await prisma.availabilityException.findUnique({ where: { id } }); if (!row) return reply.code(404).send({ ok: false, code: "AVAILABILITY_EXCEPTION_NOT_FOUND", error: "Availability exception not found." });
    if (!(await canManageAvailabilityFor(request, user, row.userId))) return reply.code(403).send({ ok: false, code: "AVAILABILITY_ACCESS_DENIED", error: "You may only manage your own availability or the availability of a direct report." });
    await prisma.availabilityException.update({ where: { id }, data: { status: "cancelled" } });
    await logActivity?.({ userId: user.id, type: "workforce", entityType: "availability_exception", entityId: row.id, title: "Availability window cancelled", message: row.kind, metadata: { targetUserId: row.userId, startsAt: row.startsAt, endsAt: row.endsAt } });
    return { ok: true };
  });

  app.post("/api/admin/workforce/departments", async (request: any, reply: any) => {
    const identity = await actorFor(request, reply, "edit"); if (!identity?.user) return;
    const body = z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(), parentId: z.string().min(1).nullable().optional(), leadUserId: z.string().min(1).nullable().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() }).parse(request.body || {});
    if (!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: body.workspaceId, userId: identity.user.id } } })))
      return reply.code(403).send({ ok: false, code: "WORKSPACE_ACCESS_DENIED", error: "You cannot manage another workspace's organization." });
    if (body.parentId) {
      const parent = await prisma.department.findFirst({ where: { id: body.parentId, workspaceId: body.workspaceId, archived: false }, select: { id: true } });
      if (!parent) return reply.code(400).send({ ok: false, code: "DEPARTMENT_PARENT_INVALID", error: "Parent must be an active department in this workspace." });
    }
    if (body.leadUserId) {
      const lead = await prisma.user.findFirst({ where: { id: body.leadUserId, archived: false, memberships: { some: { workspaceId: body.workspaceId } } }, select: { id: true } });
      if (!lead) return reply.code(400).send({ ok: false, code: "DEPARTMENT_LEAD_INVALID", error: "Lead must belong to this workspace." });
    }
    const department = await prisma.department.create({ data: { ...body, description: body.description || null, parentId: body.parentId || null, leadUserId: body.leadUserId || null, color: body.color || null } });
    return reply.code(201).send({ ok: true, department });
  });

  app.patch("/api/admin/workforce/departments/:id", async (request: any, reply: any) => {
    const identity = await actorFor(request, reply, "edit"); if (!identity?.user) return;
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({
      expectedRevision: z.number().int().min(1),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).nullable(),
      parentId: z.string().trim().min(1).nullable(),
      leadUserId: z.string().trim().min(1).nullable(),
    }).strict().parse(request.body || {});
    const existing = await prisma.department.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
    if (!existing) return reply.code(404).send({ ok: false, code: "DEPARTMENT_NOT_FOUND" });
    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: existing.workspaceId, userId: identity.user.id } } });
    if (!member) return reply.code(404).send({ ok: false, code: "DEPARTMENT_NOT_FOUND" });
    const outcome = await prisma.$transaction(async (tx: any) => {
      await acquireTransactionAdvisoryLock(tx, `cluster-company-department-graph:${existing.workspaceId}`);
      const current = await tx.department.findUnique({ where: { id }, select: { id: true, archived: true, revision: true, workspaceId: true } });
      if (!current || current.archived || current.workspaceId !== existing.workspaceId) return { code: "DEPARTMENT_NOT_FOUND", status: 404 };
      if (current.revision !== body.expectedRevision) return { code: "DEPARTMENT_REVISION_CONFLICT", status: 409 };
      if (body.parentId) {
        if (body.parentId === id) return { code: "DEPARTMENT_HIERARCHY_CYCLE", status: 409 };
        const parents: Array<{ id: string; parentId: string | null }> = await tx.department.findMany({ where: { workspaceId: existing.workspaceId, archived: false }, select: { id: true, parentId: true } });
        const parentById = new Map<string, string | null>(parents.map((entry) => [entry.id, entry.parentId]));
        const visited = new Set<string>([id]);
        let cursor: string | null = body.parentId;
        while (cursor) {
          if (visited.has(cursor)) return { code: "DEPARTMENT_HIERARCHY_CYCLE", status: 409 };
          if (!parentById.has(cursor)) return { code: "DEPARTMENT_PARENT_INVALID", status: 400 };
          visited.add(cursor);
          cursor = parentById.get(cursor) || null;
        }
      }
      if (body.leadUserId) {
        const lead = await tx.user.findFirst({ where: { id: body.leadUserId, archived: false, memberships: { some: { workspaceId: existing.workspaceId } } }, select: { id: true } });
        if (!lead) return { code: "DEPARTMENT_LEAD_INVALID", status: 400 };
      }
      const department = await tx.department.update({ where: { id }, data: { name: body.name, description: body.description, parentId: body.parentId, leadUserId: body.leadUserId, revision: { increment: 1 } } });
      return { department };
    });
    if ("code" in outcome) return reply.code(outcome.status).send({ ok: false, code: outcome.code });
    await logActivity?.({ userId: identity.user.id, type: "workforce", entityType: "department", entityId: id, title: "Department updated", metadata: { workspaceId: existing.workspaceId } });
    return { ok: true, department: outcome.department };
  });

  app.post("/api/admin/workforce/job-roles", async (request: any, reply: any) => {
    const identity = await actorFor(request, reply, "edit"); if (!identity?.user) return;
    const body = z.object({ workspaceId: z.string().min(1), departmentId: z.string().min(1).nullable().optional(), name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(), defaultCapacityHours: z.coerce.number().int().min(0).max(168).nullable().optional(), defaultMinimumHours: z.coerce.number().int().min(0).max(168).nullable().optional() }).parse(request.body || {});
    if (!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: body.workspaceId, userId: identity.user.id } } })))
      return reply.code(403).send({ ok: false, code: "WORKSPACE_ACCESS_DENIED", error: "You cannot manage another workspace's roles." });
    if (body.departmentId) {
      const department = await prisma.department.findFirst({ where: { id: body.departmentId, workspaceId: body.workspaceId, archived: false }, select: { id: true } });
      if (!department) return reply.code(400).send({ ok: false, code: "JOB_ROLE_DEPARTMENT_INVALID", error: "Role department must belong to this workspace." });
    }
    const jobRole = await prisma.jobRole.create({ data: { ...body, departmentId: body.departmentId || null, description: body.description || null, defaultCapacityHours: body.defaultCapacityHours ?? null, defaultMinimumHours: body.defaultMinimumHours ?? null } });
    return reply.code(201).send({ ok: true, jobRole });
  });
}
