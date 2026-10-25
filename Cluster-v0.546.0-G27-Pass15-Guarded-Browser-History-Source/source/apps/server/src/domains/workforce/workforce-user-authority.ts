const USER_IDENTITY_SELECT = Object.freeze({
  id: true,
  username: true,
  displayName: true,
  preferredName: true,
  avatarUrl: true,
});

export const WORKFORCE_USER_AUTHORITY_INCLUDE = Object.freeze({
  employment: {
    include: {
      department: true,
      jobRole: true,
      manager: { select: USER_IDENTITY_SELECT },
    },
  },
  workforceStatus: true,
  workingPattern: true,
  personSkills: {
    include: { skill: true },
    orderBy: [{ primary: "desc" }, { updatedAt: "desc" }],
  },
  studioTeamMemberships: {
    where: { archived: false },
    include: { team: true, teamRole: true },
    orderBy: [{ primaryMembership: "desc" }, { createdAt: "asc" }],
  },
});

function parseHours(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function displayNameFor(user: any) {
  return String(user?.preferredName || user?.displayName || user?.username || "").trim() || null;
}

function activeTeamMemberships(user: any) {
  return Array.isArray(user?.studioTeamMemberships)
    ? user.studioTeamMemberships.filter((membership: any) => !membership?.archived && membership?.team && !membership.team.archived)
    : [];
}

/**
 * Projects the first-class workforce models into the flat People API shape.
 * This is an API projection, not a second persistence authority.
 */
export function workforceAuthorityProjection(user: any) {
  const employment = user?.employment || null;
  const status = user?.workforceStatus || null;
  const workingPattern = user?.workingPattern || null;
  const memberships = activeTeamMemberships(user);
  const primaryMembership = memberships.find((membership: any) => membership.primaryMembership) || null;
  const personSkills = Array.isArray(user?.personSkills) ? user.personSkills.filter((row: any) => row?.skill && !row.skill.archived) : [];
  const invisible = String(status?.connectionVisibility || "visible") === "invisible";

  return {
    title: employment?.jobRole?.name || null,
    department: employment?.department?.name || null,
    managerUserId: employment?.managerUserId || null,
    managerName: displayNameFor(employment?.manager),
    employmentType: employment?.employmentType || null,
    workLocation: employment?.workLocation || null,
    startDate: employment?.startDate || null,
    capacityHours: employment?.capacityHours ?? null,
    minimumHours: employment?.minimumHours ?? null,
    timezone: workingPattern?.timezone || null,
    workingHours: parseHours(workingPattern?.hoursJson),
    status: invisible ? "offline" : (status?.availability || "available"),
    statusMessage: status?.availabilityMessage || null,
    skills: personSkills.map((row: any) => String(row.skill.name || "").trim()).filter(Boolean),
    expertise: personSkills.map((row: any) => ({
      name: String(row.skill.name || "").trim(),
      level: row.level || "working",
      years: row.years ?? null,
      primary: Boolean(row.primary),
    })).filter((row: any) => row.name),
    teamName: primaryMembership?.team?.name || null,
    studioTeamIds: memberships.map((membership: any) => String(membership.teamId || membership.team?.id || "")).filter(Boolean),
    studioTeams: memberships.map((membership: any) => ({
      id: membership.team.id,
      name: membership.team.name,
      department: membership.team.department || membership.team.departmentAuthority?.name || null,
      leadUserId: membership.team.leadUserId || null,
      roleLabel: membership.teamRole?.name || membership.roleLabel || null,
      allocationPercent: membership.allocationPercent ?? 100,
      primaryMembership: Boolean(membership.primaryMembership),
    })),
  };
}

export function workforceDepartmentName(user: any) {
  return workforceAuthorityProjection(user).department;
}

export function workforceTeamIds(user: any) {
  return workforceAuthorityProjection(user).studioTeamIds;
}
