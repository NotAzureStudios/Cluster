import { z } from "zod";
import { CLUSTER_WORKFLOW_RELATIONSHIP_META, validateClusterPermissionBundles, validateClusterBundleAssignments, type ClusterWorkflowRelationship, type ClusterWorkflowRelationshipSummary } from "@cluster/shared";
import { createUserService } from "./user-service.js";
import { parseJsonArray, parseJsonRecord, profileFieldDefinitionsSchema } from "./people-profile-contract.js";
import { PeopleGovernanceError, lockPeopleTeam, lockPeopleUsers, validateTeamAllocations } from "./people-governance.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE, workforceAuthorityProjection } from "../workforce/workforce-user-authority.js";
import { buildTeamAssignmentResourceIndexes } from "./team-assignment-index.js";
import { AUTHORIZATION_RULE_SELECT } from "../access/authorization.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

const memberInputSchema = z.object({
  userId: z.string().trim().min(1),
  teamRoleId: z.string().trim().min(1).optional().nullable(),
  roleLabel: z.string().trim().max(80).optional().nullable(),
  allocationPercent: z.coerce.number().int().min(0).max(200).default(100),
  primaryMembership: z.boolean().optional().default(false),
}).strict();

const teamWriteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(600).optional().nullable(),
  department: z.string().trim().max(100).optional().nullable(),
  departmentId: z.string().trim().min(1).optional().nullable(),
  leadUserId: z.string().trim().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  archived: z.boolean().optional(),
  permissionBundleIds: z.array(z.string().min(1).max(64)).max(16).optional(),
  expectedRevision: z.coerce.number().int().min(1).optional(),
}).strict();

function publicTeam(team: any, serializeUserPublicProfile: (user: any) => any) {
  return {
    id: team.id,
    name: team.name,
    description: team.description || null,
    departmentId: team.departmentAuthority?.id || team.departmentId || null,
    department: team.departmentAuthority?.name || team.department || null,
    leadUserId: team.leadUserId || null,
    lead: team.leadUser ? serializeUserPublicProfile(team.leadUser) : null,
    color: team.color || null,
    archived: Boolean(team.archived),
    revision: Number(team.revision || 1),
    permissionBundleIds: JSON.parse(String(team.permissionBundleIds || "[]")),
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    roles: (team.roles || []).filter((role: any) => !role.archived).map((role: any) => ({ id: role.id, name: role.name, description: role.description || null })),
    members: (team.members || []).filter((member: any) => !member.archived).map((member: any) => ({
      userId: member.userId,
      user: member.user ? serializeUserPublicProfile(member.user) : null,
      teamRoleId: member.teamRole?.id || member.teamRoleId || null,
      roleLabel: member.teamRole?.name || member.roleLabel || null,
      allocationPercent: Number(member.allocationPercent ?? 100),
      primaryMembership: Boolean(member.primaryMembership),
    })),
  };
}

async function resolveDepartmentAuthority(tx: any, workspaceId: string, departmentId?: string | null, departmentName?: string | null) {
  if (departmentId) {
    const department = await tx.department.findFirst({ where: { id: departmentId, workspaceId, archived: false } });
    if (!department) throw new PeopleGovernanceError("DEPARTMENT_INVALID", "Choose an active department in this workspace.", 400);
    return department;
  }
  const name = String(departmentName || "").trim();
  if (!name) return null;
  return tx.department.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: { archived: false },
    create: { workspaceId, name },
  });
}

async function resolveTeamRoleAuthority(tx: any, workspaceId: string, teamId: string, member: any, actorId?: string | null) {
  if (member.teamRoleId) {
    const role = await tx.teamRole.findFirst({ where: { id: member.teamRoleId, workspaceId, teamId, archived: false } });
    if (!role) throw new PeopleGovernanceError("TEAM_ROLE_INVALID", "Choose an active role for this team.", 400);
    return role;
  }
  const name = String(member.roleLabel || "").trim();
  if (!name) return null;
  return tx.teamRole.upsert({
    where: { teamId_name: { teamId, name } },
    update: { archived: false },
    create: { workspaceId, teamId, name, createdById: actorId || null },
  });
}

async function loadTeams(prisma: any, includeArchived = false) {
  return prisma.studioTeam.findMany({
    where: includeArchived ? undefined : { archived: false },
    include: {
      leadUser: { include: WORKFORCE_USER_AUTHORITY_INCLUDE },
      departmentAuthority: true,
      roles: { where: { archived: false }, orderBy: { name: "asc" } },
      members: { include: { teamRole: true, user: { include: WORKFORCE_USER_AUTHORITY_INCLUDE } }, orderBy: [{ primaryMembership: "desc" }, { createdAt: "asc" }] },
    },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
    take: 500,
  });
}

export function registerTeamRoutes(deps: any) {
  const { app, prisma, serializeUserPublicProfile, parseLabels, authorization, getCurrentUser, logActivity, readSettings, patchSettings, readSettingPreconditions } = deps;
  const service = createUserService({ prisma });
  async function validateTeamPermissionBundles(request: any, reply: any, ids: string[] | undefined) {
    if (ids === undefined) return undefined;
    // Tool-permission bundles can grant powerful Studio authority. Only an
    // Owner/Admin may attach one, independently of People management access.
    if (!(await authorization.requireAdmin(request, reply))) return null;
    try {
      const settings = await readSettings();
      return validateClusterBundleAssignments(ids, validateClusterPermissionBundles(settings.studioPermissionBundles || []), "Studio Team");
    } catch (error) {
      reply.code(400).send({ ok: false, code: "TEAM_BUNDLE_INVALID", error: error instanceof Error ? error.message : "Invalid Team permission bundles." });
      return null;
    }
  }

  app.get("/api/team/context", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "view"))) return;
    const identity = await authorization.identityForRequest(request);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(1000).optional().default(500), historyUserId: z.string().trim().min(1).optional() }).parse(request.query || {});
    const [teams, users, projects, settings] = await Promise.all([
      loadTeams(prisma),
      prisma.user.findMany({ where: { archived: false }, include: { memberships: true, ...WORKFORCE_USER_AUTHORITY_INCLUDE }, orderBy: [{ displayName: "asc" }, { username: "asc" }], take: query.limit }),
      prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, projectType: true, status: true, source: true, updatedAt: true, memberships: { where: { status: "active" }, select: { userId: true } } }, orderBy: { updatedAt: "desc" }, take: 5000 }),
      readSettings(),
    ]);
    const historyUserIds = query.historyUserId ? users.filter((user: any) => user.id === query.historyUserId).map((user: any) => user.id) : users.map((user: any) => user.id);
    const recentProjectActivityCandidates = historyUserIds.length ? await prisma.activityEvent.findMany({
      where: { userId: { in: historyUserIds }, projectId: { not: null } },
      include: {
        project: { include: { memberships: { where: { status: "active" } } } },
        board: true,
        whiteboard: true,
        card: { include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(10_000, Math.max(1000, historyUserIds.length * 20)),
    }) : [];
    const recentProjectActivity = await authorization.filterActivityEventsForRequest(request, recentProjectActivityCandidates, "view");
    const projectIds = projects.map((project: any) => project.id);
    const accessRules = projectIds.length ? await prisma.accessRule.findMany({ where: { status: "active", targetKind: "project", targetId: { in: projectIds } }, select: AUTHORIZATION_RULE_SELECT }) : [];
    const visibleProjects = !identity.user || identity.decorated?.isAdmin
      ? projects
      : projects.filter((project: any) => authorization.hasTargetAccess(identity.user, identity.role, "project", project.id, project, accessRules, "view"));
    const visibleProjectIds = new Set(visibleProjects.map((project: any) => project.id));
    const historyByUser = new Map<string, Map<string, { projectId: string; lastContributionAt: Date; contributions: number }>>();
    for (const activity of recentProjectActivity) {
      if (!activity.userId || !activity.projectId || !visibleProjectIds.has(activity.projectId)) continue;
      let byProject = historyByUser.get(activity.userId); if (!byProject) { byProject = new Map(); historyByUser.set(activity.userId, byProject); }
      const existing = byProject.get(activity.projectId);
      if (existing) existing.contributions += 1;
      else byProject.set(activity.projectId, { projectId: activity.projectId, lastContributionAt: activity.createdAt, contributions: 1 });
    }
    const projectById = new Map(visibleProjects.map((project: any) => [project.id, project]));
    const activeProjectIdsByUser = new Map<string, Set<string>>();
    for (const project of visibleProjects) for (const membership of project.memberships || []) {
      const userId = String(membership.userId || ""); if (!userId) continue;
      const set = activeProjectIdsByUser.get(userId) || new Set<string>(); set.add(project.id); activeProjectIdsByUser.set(userId, set);
    }
    const people = users.map((user: any) => {
      const workforce = workforceAuthorityProjection(user);
      const expertise = workforce.expertise.slice(0, 40);
      const activeTeamMemberships = (user.studioTeamMemberships || []).filter((membership: any) => !membership.archived && membership.team && !membership.team.archived);
      const allocationPercent = activeTeamMemberships.reduce((sum: number, membership: any) => sum + Number(membership.allocationPercent || 0), 0);
      const allocatedCapacityHours = workforce.capacityHours == null ? null : Math.round((Number(workforce.capacityHours) * allocationPercent / 100) * 10) / 10;
      const allocationState = !activeTeamMemberships.length ? "unallocated" : allocationPercent > 100 ? "overallocated" : allocationPercent < 100 ? "underallocated" : "balanced";
      const activeIds = activeProjectIdsByUser.get(user.id) || new Set<string>();
      const history = historyByUser.get(user.id) || new Map();
      const projectIds = [...new Set([...activeIds, ...history.keys()])].slice(0, 50);
      const publicProfile = serializeUserPublicProfile(user);
      return {
        ...publicProfile,
        expertise,
        workingHours: publicProfile.workingHours || {},
        teamAllocationPercent: allocationPercent,
        allocatedCapacityHours,
        allocationState,
        projectHistory: projectIds.map((projectId) => {
          const project: any = projectById.get(projectId);
          const activity = history.get(projectId);
          return project ? { id: project.id, name: project.name, projectType: project.projectType, status: project.status, active: activeIds.has(projectId), lastContributionAt: activity?.lastContributionAt || project.updatedAt, contributions: activity?.contributions || 0 } : null;
        }).filter(Boolean),
      };
    });
    const expertiseCounts = new Map<string, { name: string; total: number; advanced: number; experts: number }>();
    for (const person of people) for (const item of person.expertise || []) {
      const name = String(item?.name || "").trim(); if (!name) continue;
      const key = name.toLocaleLowerCase(); const current = expertiseCounts.get(key) || { name, total: 0, advanced: 0, experts: 0 };
      current.total += 1; if (["advanced", "expert"].includes(String(item.level))) current.advanced += 1; if (item.level === "expert") current.experts += 1; expertiseCounts.set(key, current);
    }
    return {
      generatedAt: new Date().toISOString(),
      directory: { limit: query.limit, loaded: users.length, truncated: users.length >= query.limit, historyEvidenceRows: recentProjectActivity.length },
      teams: teams.map((team: any) => publicTeam(team, serializeUserPublicProfile)),
      people,
      profileFieldDefinitions: profileFieldDefinitionsSchema.parse(settings.studioPeopleProfileFields || []).filter((field) => field.visibility !== "private"),
      expertise: [...expertiseCounts.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 100),
      capacity: {
        configuredPeople: users.filter((user: any) => workforceAuthorityProjection(user).capacityHours != null).length,
        totalHours: users.reduce((sum: number, user: any) => sum + Number(workforceAuthorityProjection(user).capacityHours || 0), 0),
        minimumHours: users.reduce((sum: number, user: any) => sum + Number(workforceAuthorityProjection(user).minimumHours || 0), 0),
        workingHoursConfigured: users.filter((user: any) => Object.keys(workforceAuthorityProjection(user).workingHours).some((key) => key !== "timezone")).length,
        overallocatedPeople: people.filter((person: any) => person.allocationState === "overallocated").length,
        underallocatedPeople: people.filter((person: any) => person.allocationState === "underallocated").length,
        totalAllocatedHours: Math.round(people.reduce((sum: number, person: any) => sum + Number(person.allocatedCapacityHours || 0), 0) * 10) / 10,
      },
    };
  });

  app.get("/api/team/permission-bundles", async (request: any, reply: any) => {
    reply.header("Cache-Control", "private, no-store");
    if (!(await authorization.requireAdmin(request, reply))) return;
    const settings = await readSettings();
    return validateClusterPermissionBundles(settings.studioPermissionBundles || []).map((bundle) => ({ id: bundle.id, label: bundle.label, revision: bundle.revision, enabled: bundle.enabled !== false }));
  });

  app.get("/api/team/teams", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "view"))) return;
    const query = z.object({ includeArchived: z.coerce.boolean().optional().default(false) }).parse(request.query || {});
    return (await loadTeams(prisma, query.includeArchived)).map((team: any) => publicTeam(team, serializeUserPublicProfile));
  });

  app.post("/api/team/teams", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "manage"))) return;
    const actor = await getCurrentUser(request); const body = teamWriteSchema.omit({ expectedRevision: true, archived: true }).parse(request.body || {});
    const bundleIds = await validateTeamPermissionBundles(request, reply, body.permissionBundleIds);
    if (bundleIds === null) return;
    if (body.leadUserId && !(await prisma.user.findFirst({ where: { id: body.leadUserId, archived: false }, select: { id: true } }))) return reply.code(400).send({ ok: false, error: "Choose an active team lead." });
    const workspace = await prisma.workspace.findFirstOrThrow();
    const departmentAuthority = await resolveDepartmentAuthority(prisma, workspace.id, body.departmentId, body.department);
    const team = await prisma.studioTeam.create({
      data: { workspaceId: workspace.id, name: body.name, description: body.description || null, departmentId: departmentAuthority?.id || null, department: departmentAuthority?.name || null, leadUserId: body.leadUserId || null, color: body.color?.toLowerCase() || null, ...(bundleIds !== undefined ? { permissionBundleIds: JSON.stringify(bundleIds) } : {}) },
      include: { leadUser: { include: WORKFORCE_USER_AUTHORITY_INCLUDE }, departmentAuthority: true, roles: { where: { archived: false } }, members: { include: { user: { include: WORKFORCE_USER_AUTHORITY_INCLUDE }, teamRole: true } } },
    }).catch((error: any) => { if (String(error?.code) === "P2002") return null; throw error; });
    if (!team) return reply.code(409).send({ ok: false, error: "A team with that name already exists." });
    await logActivity({ userId: actor?.id, type: "created", entityType: "team", entityId: team.id, title: "Team created", message: team.name });
    return publicTeam(team, serializeUserPublicProfile);
  });

  app.patch("/api/team/teams/:teamId", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "manage"))) return;
    const actor = await getCurrentUser(request); const { teamId } = z.object({ teamId: z.string() }).parse(request.params); const body = teamWriteSchema.partial().parse(request.body || {});
    const bundleIds = await validateTeamPermissionBundles(request, reply, body.permissionBundleIds);
    if (bundleIds === null) return;
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        await lockPeopleTeam(tx, teamId);
        const existing = await tx.studioTeam.findUnique({ where: { id: teamId }, include: { members: { where: { archived: false }, select: { userId: true, primaryMembership: true } } } });
        if (!existing) throw new PeopleGovernanceError("TEAM_NOT_FOUND", "Team not found.", 404);
        if (body.expectedRevision && Number(existing.revision || 1) !== body.expectedRevision) throw new PeopleGovernanceError("TEAM_REVISION_CONFLICT", "This team changed since it was opened.", 409, { currentRevision: existing.revision });
        if (body.leadUserId && !(await tx.user.findFirst({ where: { id: body.leadUserId, archived: false }, select: { id: true } }))) throw new PeopleGovernanceError("TEAM_LEAD_INVALID", "Choose an active team lead.", 400);
        const departmentTouched = body.departmentId !== undefined || body.department !== undefined;
        const departmentAuthority = departmentTouched ? await resolveDepartmentAuthority(tx, existing.workspaceId, body.departmentId, body.department) : undefined;
        const saved = await tx.studioTeam.update({
          where: { id: teamId },
          data: {
            name: body.name, description: body.description, leadUserId: body.leadUserId, color: body.color?.toLowerCase(), archived: body.archived, revision: { increment: 1 },
            ...(departmentTouched ? { departmentId: departmentAuthority?.id || null, department: departmentAuthority?.name || null } : {}),
            ...(bundleIds !== undefined ? { permissionBundleIds: JSON.stringify(bundleIds) } : {}),
          },
          include: { leadUser: { include: WORKFORCE_USER_AUTHORITY_INCLUDE }, departmentAuthority: true, roles: { where: { archived: false } }, members: { include: { user: { include: WORKFORCE_USER_AUTHORITY_INCLUDE }, teamRole: true } } },
        }).catch((error: any) => { if (String(error?.code) === "P2002") throw new PeopleGovernanceError("TEAM_NAME_CONFLICT", "A team with that name already exists.", 409); throw error; });
        return saved;
      });
      await logActivity({ userId: actor?.id, type: body.archived ? "archived" : "updated", entityType: "team", entityId: teamId, title: body.archived ? "Team archived" : "Team updated", message: updated.name });
      return publicTeam(updated, serializeUserPublicProfile);
    } catch (error) {
      if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message, ...(error.details || {}) });
      throw error;
    }
  });

  app.put("/api/team/teams/:teamId/members", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "manage"))) return;
    const actor = await getCurrentUser(request); const { teamId } = z.object({ teamId: z.string() }).parse(request.params);
    const body = z.object({ members: z.array(memberInputSchema).max(500), expectedRevision: z.coerce.number().int().min(1).optional() }).parse(request.body || {});
    const unique = new Map(body.members.map((member) => [member.userId, member])); if (unique.size !== body.members.length) return reply.code(400).send({ ok: false, error: "Each person can appear once in a team." });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        await lockPeopleTeam(tx, teamId);
        const team = await tx.studioTeam.findUnique({ where: { id: teamId }, include: { members: true } });
        if (!team) throw new PeopleGovernanceError("TEAM_NOT_FOUND", "Team not found.", 404);
        if (team.archived) throw new PeopleGovernanceError("TEAM_ARCHIVED", "Restore this team before changing membership.", 409);
        if (body.expectedRevision && Number(team.revision || 1) !== body.expectedRevision) throw new PeopleGovernanceError("TEAM_REVISION_CONFLICT", "This team changed since it was opened.", 409, { currentRevision: team.revision });
        const impactedUserIds = [...new Set([...(team.members || []).map((member: any) => member.userId), ...body.members.map((member) => member.userId)])];
        await lockPeopleUsers(tx, impactedUserIds);
        const userIds = [...unique.keys()];
        const validUsers = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds }, archived: false }, select: { id: true } }) : [];
        if (validUsers.length !== userIds.length) throw new PeopleGovernanceError("TEAM_MEMBER_INVALID", "One or more team members are no longer active.", 400);
        const allocationTotals = await validateTeamAllocations(tx, teamId, body.members);
        await tx.studioTeamMember.updateMany({ where: { teamId }, data: { archived: true, primaryMembership: false } });
        for (const member of body.members) {
          if (member.primaryMembership) await tx.studioTeamMember.updateMany({ where: { userId: member.userId, teamId: { not: teamId }, archived: false }, data: { primaryMembership: false } });
          const teamRole = await resolveTeamRoleAuthority(tx, team.workspaceId, teamId, member, actor?.id);
          await tx.studioTeamMember.upsert({
            where: { teamId_userId: { teamId, userId: member.userId } },
            update: { teamRoleId: teamRole?.id || null, roleLabel: teamRole?.name || null, allocationPercent: member.allocationPercent, primaryMembership: member.primaryMembership, archived: false },
            create: { teamId, userId: member.userId, teamRoleId: teamRole?.id || null, roleLabel: teamRole?.name || null, allocationPercent: member.allocationPercent, primaryMembership: member.primaryMembership },
          });
        }
        const savedTeam = await tx.studioTeam.update({
          where: { id: teamId }, data: { revision: { increment: 1 } },
          include: { leadUser: { include: WORKFORCE_USER_AUTHORITY_INCLUDE }, departmentAuthority: true, roles: { where: { archived: false } }, members: { include: { user: { include: WORKFORCE_USER_AUTHORITY_INCLUDE }, teamRole: true } } },
        });
        return { team, savedTeam, allocationTotals };
      });
      const overallocated = [...result.allocationTotals.entries()].filter(([, total]) => total > 100).map(([userId, allocationPercent]) => ({ userId, allocationPercent }));
      await logActivity({ userId: actor?.id, type: "updated", entityType: "team", entityId: teamId, title: "Team membership updated", message: `${result.team.name} · ${body.members.length} active members${overallocated.length ? ` · ${overallocated.length} overallocated` : ""}` });
      return { ...publicTeam(result.savedTeam, serializeUserPublicProfile), allocationWarnings: overallocated };
    } catch (error) {
      if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message, ...(error.details || {}) });
      throw error;
    }
  });

  app.get("/api/team/profile-fields", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "manage"))) return;
    const [settings, expectedSettings] = await Promise.all([readSettings(), readSettingPreconditions(["studioPeopleProfileFields"])]);
    const raw = expectedSettings.studioPeopleProfileFields;
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, fields: raw.exists ? raw.value : settings.studioPeopleProfileFields || [], expectedSettings };
  });

  app.put("/api/team/profile-fields", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "manage"))) return;
    const actor = await getCurrentUser(request);
    const body = z.object({
      fields: profileFieldDefinitionsSchema,
      expectedSettings: z.object({ studioPeopleProfileFields: z.object({ exists: z.boolean(), value: z.unknown().optional() }).strict() }).strict(),
    }).strict().parse(request.body || {});
    try {
      await patchSettings({ studioPeopleProfileFields: body.fields }, body.expectedSettings);
    } catch (error) {
      if ((error as any)?.code === "STUDIO_SETTINGS_CONFLICT") {
        return reply.code(409).send({ ok: false, code: "PROFILE_FIELDS_CONFLICT", error: "Profile field definitions changed. Reload before submitting.", conflictingKeys: (error as any).conflictingKeys || [] });
      }
      throw error;
    }
    await logActivity({ userId: actor?.id, type: "updated", entityType: "settings", entityId: "people-profile-fields", title: "People profile fields updated", message: `${body.fields.length} Studio profile fields` });
    return { ok: true, fields: body.fields, expectedSettings: await readSettingPreconditions(["studioPeopleProfileFields"]) };
  });

  app.get("/api/team/assignments", async (request: any, reply: any) => {
    const identity = await authorization.identityForRequest(request);
    if (!identity.user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const canTeamView = Boolean(identity.decorated?.isAdmin || authorization.hasToolPermission(identity.user, identity.role, "people", "view"));
    const canMyWorkView = Boolean(identity.decorated?.isAdmin || authorization.hasToolPermission(identity.user, identity.role, "mywork", "view"));
    if (!canTeamView && !canMyWorkView) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "My Work or People access is required." });
    const query = z.object({ scope: z.enum(["mine", "team"]).optional().default("team") }).parse(request.query || {});
    // Callers such as Home/My Work usually need only the current user's assignments.
    // Users without People visibility are always scoped to self even if an older client
    // omits the explicit scope, preserving the authorization boundary while avoiding a
    // studio-wide card/calendar/scheduler scan.
    const scopedUserId = query.scope === "mine" || !canTeamView ? String(identity.user.id) : null;

    const [allUsers, projects, boards, lists, cards, calendarEvents, scheduleBlocks] = await service.listTeamResources({ userId: scopedUserId });
    const scopedProjectIdSet = scopedUserId ? new Set<string>() : null;
    if (scopedProjectIdSet) {
      for (const project of projects) {
        if ((project.memberships || []).some((membership: any) => String(membership.userId || "") === scopedUserId)) scopedProjectIdSet.add(String(project.id));
      }
      for (const board of boards) if (board.project?.id) scopedProjectIdSet.add(String(board.project.id));
      for (const list of lists) if (list.board?.project?.id) scopedProjectIdSet.add(String(list.board.project.id));
      for (const card of cards) if (card.list?.board?.project?.id) scopedProjectIdSet.add(String(card.list.board.project.id));
      for (const event of calendarEvents) if (event.projectId) scopedProjectIdSet.add(String(event.projectId));
      for (const block of scheduleBlocks) if (block.projectId) scopedProjectIdSet.add(String(block.projectId));
    }
    const candidateProjects = scopedProjectIdSet ? projects.filter((project: any) => scopedProjectIdSet.has(String(project.id))) : projects;
    const projectIds = candidateProjects.map((project: any) => String(project.id));
    const boardIds = boards.map((board: any) => String(board.id));
    const ruleOr: any[] = [];
    if (projectIds.length) ruleOr.push({ targetKind: "project", targetId: { in: projectIds } });
    if (boardIds.length) ruleOr.push({ targetKind: "board", targetId: { in: boardIds } });
    const accessRules = ruleOr.length ? await prisma.accessRule.findMany({ where: { status: "active", OR: ruleOr }, select: AUTHORIZATION_RULE_SELECT }).catch(() => []) : [];
    const projectMap = new Map(candidateProjects.map((project: any) => [String(project.id), project]));
    const visibleProjects = identity.decorated?.isAdmin ? candidateProjects : candidateProjects.filter((project: any) => authorization.hasProjectResourceAccess(identity.user, identity.role, project, accessRules, "view"));
    const visibleProjectIds = new Set(visibleProjects.map((project: any) => String(project.id)));
    const visibleBoards = boards.filter((board: any) => {
      const projectId = String(board.project?.id || "");
      const project = projectMap.get(projectId);
      return Boolean(project && visibleProjectIds.has(projectId) && authorization.hasTargetAccess(identity.user, identity.role, "board", board.id, project, accessRules, "view"));
    });
    const visibleBoardIds = new Set(visibleBoards.map((board: any) => String(board.id)));
    const visibleLists = lists.filter((list: any) => visibleBoardIds.has(String(list.board?.id || "")));
    const visibleListIds = new Set(visibleLists.map((list: any) => String(list.id)));
    const canTickets = authorization.hasToolPermission(identity.user, identity.role, "tickets", "view");
    const visibleCards = cards.filter((card: any) => {
      const board = card.list?.board;
      const projectId = String(board?.project?.id || "");
      const project = projectMap.get(projectId);
      if (!project || !visibleBoardIds.has(String(board?.id || ""))) return false;
      const isTicket = card.workItemKind === "ticket";
      return !isTicket || canTickets;
    });
    const visibleCardIds = new Set<string>(visibleCards.map((card: any) => String(card.id)));
    const visibleCalendar: any[] = [];
    for (const event of calendarEvents) {
      const projectId = String(event.projectId || "");
      if (projectId && !visibleProjectIds.has(projectId)) continue;
      if (await canAccessCalendarEvent(authorization, request, event, "view")) visibleCalendar.push(event);
    }
    const visibleCalendarIds = new Set<string>(visibleCalendar.map((event: any) => String(event.id)));
    const visibleSchedule = scheduleBlocks.filter((block: any) => {
      const projectId = String(block.projectId || "");
      const project = projectId ? projectMap.get(projectId) : null;
      if (projectId && !visibleProjectIds.has(projectId)) return false;
      if (block.boardId && !visibleBoardIds.has(String(block.boardId))) return false;
      if (block.cardId && !visibleCardIds.has(String(block.cardId))) return false;
      return authorization.hasTargetAccess(identity.user, identity.role, "schedule", block.id, project, accessRules, "view");
    });
    const visibleScheduleIds = new Set<string>(visibleSchedule.map((block: any) => String(block.id)));

    const endpointVisible = (type: unknown, id: unknown) => {
      const kind = String(type || "").toLowerCase().replaceAll("-", "_");
      const targetId = String(id || "");
      if (kind === "project") return visibleProjectIds.has(targetId);
      if (kind === "board") return visibleBoardIds.has(targetId);
      if (["list", "column"].includes(kind)) return visibleListIds.has(targetId);
      if (["card", "ticket"].includes(kind)) return visibleCardIds.has(targetId);
      if (["calendar", "calendar_event"].includes(kind)) return visibleCalendarIds.has(targetId);
      if (["schedule", "scheduler", "schedule_block", "scheduler_block"].includes(kind)) return visibleScheduleIds.has(targetId);
      return false;
    };
    const relationshipEndpointClauses: any[] = [];
    if (scopedUserId) {
      const pushEndpointClauses = (types: string[], ids: Set<string>) => {
        if (!ids.size) return;
        const idFilter = { in: [...ids] };
        relationshipEndpointClauses.push(
          { sourceType: { in: types }, sourceId: idFilter },
          { targetType: { in: types }, targetId: idFilter },
        );
      };
      pushEndpointClauses(["card", "ticket"], visibleCardIds);
      pushEndpointClauses(["calendar", "calendar_event"], visibleCalendarIds);
      pushEndpointClauses(["schedule", "scheduler", "schedule_block", "scheduler_block"], visibleScheduleIds);
    }
    const relationships = visibleProjectIds.size && (!scopedUserId || relationshipEndpointClauses.length) ? await prisma.projectRelationship.findMany({
      where: {
        projectId: { in: [...visibleProjectIds] },
        ...(scopedUserId ? { OR: relationshipEndpointClauses } : {}),
      },
      select: { sourceType: true, sourceId: true, targetType: true, targetId: true, relationship: true, critical: true },
    }) : [];
    const visibleRelationships = relationships.filter((relationship: any) => endpointVisible(relationship.sourceType, relationship.sourceId) && endpointVisible(relationship.targetType, relationship.targetId));
    const relationMap = new Map<string, ClusterWorkflowRelationshipSummary>();
    const pushRelationship = (kind: string, id: string, relationship: string, critical: boolean) => {
      const key = `${kind}:${id}`; const current = relationMap.get(key) || { total: 0, blockers: 0, critical: 0, labels: [] }; current.total += 1;
      if (CLUSTER_WORKFLOW_RELATIONSHIP_META[relationship as ClusterWorkflowRelationship]?.blocking) current.blockers += 1; if (critical) current.critical += 1;
      const label = relationship.replaceAll("_", " "); if (!current.labels.includes(label) && current.labels.length < 4) current.labels.push(label); relationMap.set(key, current);
    };
    visibleRelationships.forEach((relationship: any) => { pushRelationship(relationship.sourceType, relationship.sourceId, relationship.relationship, Boolean(relationship.critical)); pushRelationship(relationship.targetType, relationship.targetId, relationship.relationship, Boolean(relationship.critical)); });
    const relationshipSummary = (...keys: string[]) => { const summaries = keys.map((key) => relationMap.get(key)).filter(Boolean) as ClusterWorkflowRelationshipSummary[]; if (!summaries.length) return undefined; return summaries.reduce<ClusterWorkflowRelationshipSummary>((result, item) => ({ total: result.total + item.total, blockers: result.blockers + item.blockers, critical: result.critical + item.critical, labels: [...new Set([...result.labels, ...item.labels])].slice(0, 4) }), { total: 0, blockers: 0, critical: 0, labels: [] }); };
    const { projectsByUser, boardsByUser, columnsByUser, cardsByUser, calendarByUser, scheduleByUser } = buildTeamAssignmentResourceIndexes({
      projects: visibleProjects,
      boards: visibleBoards,
      lists: visibleLists,
      cards: visibleCards,
      calendarEvents: visibleCalendar,
      scheduleBlocks: visibleSchedule,
      parseAssignedIds: parseLabels,
      relationshipSummary,
    });
    const users = scopedUserId ? allUsers.filter((user: any) => String(user.id) === String(identity.user.id)) : allUsers;
    const payload = users.map((user: any) => ({
      user: serializeUserPublicProfile(user),
      projects: projectsByUser.get(user.id) || [],
      boards: boardsByUser.get(user.id) || [],
      columns: columnsByUser.get(user.id) || [],
      cards: cardsByUser.get(user.id) || [],
      calendarEvents: calendarByUser.get(user.id) || [],
      scheduleBlocks: scheduleByUser.get(user.id) || [],
    }));
    return sendPrivateRevalidated(request, reply, payload);
  });
}
