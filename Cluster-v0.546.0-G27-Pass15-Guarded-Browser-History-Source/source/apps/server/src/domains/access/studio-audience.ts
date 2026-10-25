import { studioAudienceSchema } from "@cluster/shared";

export function parseStudioJson(value: unknown, fallback: any) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

export function parseStudioAudience(value: unknown) {
  return studioAudienceSchema.parse(parseStudioJson(value, { mode: "all", targets: [] }));
}

function stringId(value: unknown) {
  return String(value || "").trim();
}

function activeProjectMembership(row: any) {
  return String(row?.status || "active") === "active" && (!row?.endsAt || new Date(row.endsAt).getTime() >= Date.now());
}

export type StudioAudienceUserContext = {
  departmentId: string;
  jobRoleId: string;
  teamIds: Set<string>;
  projectIds: Set<string>;
};

export async function loadStudioAudienceUserContext(
  prisma: any, user: any, options: { strict?: boolean } = {},
): Promise<StudioAudienceUserContext> {
  // Invalidation streams reveal resource identities. Failed audience reads
  // must terminate the stream, especially for exclusion-based audiences.
  const recover = (promise: Promise<any>, fallback: any): Promise<any> => options.strict ? promise : promise.catch(() => fallback);
  const [employment, teamMemberships, projectMemberships] = await Promise.all([
    recover(prisma.employment.findUnique({ where: { userId: user.id }, select: { departmentId: true, jobRoleId: true, active: true } }), null),
    recover(prisma.studioTeamMember.findMany({ where: { userId: user.id, archived: false }, select: { teamId: true } }), []),
    recover(prisma.projectMembership.findMany({ where: { userId: user.id, status: "active" }, select: { projectId: true, status: true, endsAt: true } }), []),
  ]);
  return {
    departmentId: employment?.active === false ? "" : stringId(employment?.departmentId),
    jobRoleId: employment?.active === false ? "" : stringId(employment?.jobRoleId),
    teamIds: new Set(teamMemberships.map((row: any) => stringId(row.teamId)).filter(Boolean)),
    projectIds: new Set(projectMemberships.filter(activeProjectMembership).map((row: any) => stringId(row.projectId)).filter(Boolean)),
  };
}

export function studioAudienceMatchesContext(audienceRaw: unknown, userId: string, context: StudioAudienceUserContext) {
  const audience = parseStudioAudience(audienceRaw);
  if (audience.mode === "all" || !audience.targets.length) return true;
  const matches = audience.targets.some((target: any) => {
    const id = stringId(target.id);
    if (target.kind === "studio") return true;
    if (target.kind === "user") return id === String(userId);
    if (target.kind === "department") return Boolean(id && id === context.departmentId);
    if (target.kind === "team") return context.teamIds.has(id);
    if (target.kind === "role") return Boolean(id && id === context.jobRoleId);
    if (target.kind === "project") return context.projectIds.has(id);
    return false;
  });
  return audience.mode === "exclude" ? !matches : matches;
}

/**
 * Studio Audience is resolved exclusively through normalized People authorities:
 * Employment -> Department / JobRole, StudioTeamMember, ProjectMembership, and User.
 * Legacy profile labels/project permission blobs are intentionally not consulted.
 */
export async function studioAudienceMatchesUser(prisma: any, audienceRaw: unknown, user: any) {
  const audience = parseStudioAudience(audienceRaw);
  if (audience.mode === "all" || !audience.targets.length) return true;
  const context = await loadStudioAudienceUserContext(prisma, user);
  return studioAudienceMatchesContext(audience, String(user.id), context);
}

export async function resolveStudioAudienceUserIds(prisma: any, audienceRaw: unknown, options: { strict?: boolean } = {}) {
  const audience = parseStudioAudience(audienceRaw);
  const users = await prisma.user.findMany({
    where: { archived: false, accountState: { notIn: ["PRIVACY_ERASED", "DISABLED", "SUSPENDED"] }, OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] },
    select: { id: true },
  });
  const userIds = users.map((user: any) => String(user.id));
  if (audience.mode === "all" || !audience.targets.length) return userIds;
  if (!userIds.length) return [];

  const kinds = new Set(audience.targets.map((target: any) => String(target.kind)));
  const recover = (promise: Promise<any>) => options.strict ? promise : promise.catch(() => []);
  const [employments, teamMemberships, projectMemberships] = await Promise.all([
    kinds.has("department") || kinds.has("role")
      ? recover(prisma.employment.findMany({ where: { userId: { in: userIds }, active: true }, select: { userId: true, departmentId: true, jobRoleId: true } }))
      : Promise.resolve([]),
    kinds.has("team")
      ? recover(prisma.studioTeamMember.findMany({ where: { userId: { in: userIds }, archived: false }, select: { userId: true, teamId: true } }))
      : Promise.resolve([]),
    kinds.has("project")
      ? recover(prisma.projectMembership.findMany({ where: { userId: { in: userIds }, status: "active" }, select: { userId: true, projectId: true, status: true, endsAt: true } }))
      : Promise.resolve([]),
  ]);

  const employmentByUser = new Map<string, any>(employments.map((row: any) => [String(row.userId), row] as [string, any]));
  const teamsByUser = new Map<string, Set<string>>();
  for (const row of teamMemberships) {
    const key = String(row.userId);
    const ids = teamsByUser.get(key) || new Set<string>();
    if (stringId(row.teamId)) ids.add(stringId(row.teamId));
    teamsByUser.set(key, ids);
  }
  const projectsByUser = new Map<string, Set<string>>();
  for (const row of projectMemberships.filter(activeProjectMembership)) {
    const key = String(row.userId);
    const ids = projectsByUser.get(key) || new Set<string>();
    if (stringId(row.projectId)) ids.add(stringId(row.projectId));
    projectsByUser.set(key, ids);
  }

  const matched = new Set<string>();
  for (const userId of userIds) {
    const employment = employmentByUser.get(userId);
    const teams = teamsByUser.get(userId) || new Set<string>();
    const projects = projectsByUser.get(userId) || new Set<string>();
    const hit = audience.targets.some((target: any) => {
      const id = stringId(target.id);
      if (target.kind === "studio") return true;
      if (target.kind === "user") return id === userId;
      if (target.kind === "department") return Boolean(id && id === stringId(employment?.departmentId));
      if (target.kind === "team") return teams.has(id);
      if (target.kind === "role") return Boolean(id && id === stringId(employment?.jobRoleId));
      if (target.kind === "project") return projects.has(id);
      return false;
    });
    if (hit) matched.add(userId);
  }
  return audience.mode === "exclude" ? userIds.filter((id: string) => !matched.has(id)) : userIds.filter((id: string) => matched.has(id));
}
