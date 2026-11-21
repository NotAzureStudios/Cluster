import type { AuthorizationService } from "./authorization.js";

/* Who can open this project, at what level, and why. Levels come from the
   same checks that guard every project request (hasProjectResourceAccess);
   the reason names the layer that decided it. Bounded to one page of the
   workspace; `truncated` says when there are more. */

const LEVELS = ["manage", "contribute", "view"] as const;
const PAGE = 300;

type Reason = { kind: "admin" | "lead" | "member" | "override" | "rule-allow" | "rule-deny" | "restricted" | "external" | "default" | "inactive"; label: string; ruleId?: string };

export async function listProjectAccessPeople(input: { prisma: any; authorization: AuthorizationService; project: any }) {
  const { prisma, authorization, project } = input;
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: project.workspaceId, user: { archived: false } },
    include: { user: true },
    orderBy: { userId: "asc" },
    take: PAGE + 1,
  });
  const truncated = members.length > PAGE;
  const rows = members.slice(0, PAGE);
  const ids = rows.map((row: any) => row.userId);
  const [memberships, teamRows, rules] = await Promise.all([
    prisma.projectMembership.findMany({ where: { projectId: project.id, userId: { in: ids }, status: "active" } }),
    prisma.studioTeamMember.findMany({ where: { userId: { in: ids }, archived: false, team: { archived: false } }, select: { userId: true, teamId: true, team: { select: { name: true } } } }),
    prisma.accessRule.findMany({ where: { status: "active", targetKind: "project", targetId: project.id } }),
  ]);
  const scopedProject = { ...project, memberships };
  const people = rows.map((row: any) => {
    const user = { ...row.user, studioTeamMemberships: teamRows.filter((team: any) => team.userId === row.userId).map((team: any) => ({ teamId: team.teamId, archived: false })) };
    const level = LEVELS.find((candidate) => authorization.hasProjectResourceAccess(user, row.role, scopedProject, rules, candidate)) || "none";
    return {
      userId: row.userId,
      name: String(row.user.preferredName || row.user.displayName || row.user.username || "Unknown"),
      username: row.user.username || null,
      avatarUrl: row.user.avatarUrl || null,
      role: row.role || "member",
      level,
      reason: reasonFor(authorization, user, row.role, scopedProject, rules, level),
    };
  });
  const order = { manage: 0, contribute: 1, view: 2, none: 3 } as Record<string, number>;
  people.sort((a: any, b: any) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
  return { ok: true as const, projectId: project.id, truncated, people };
}

/* One person's effective level on one project, by the same rule as the list. */
export async function projectLevelForUser(input: { prisma: any; authorization: AuthorizationService; project: any; user: any; role: string | null }) {
  const { prisma, authorization, project, user, role } = input;
  const [memberships, teamRows, rules] = await Promise.all([
    prisma.projectMembership.findMany({ where: { projectId: project.id, userId: user.id, status: "active" } }),
    prisma.studioTeamMember.findMany({ where: { userId: user.id, archived: false, team: { archived: false } }, select: { teamId: true } }),
    prisma.accessRule.findMany({ where: { status: "active", targetKind: "project", targetId: project.id } }),
  ]);
  const scoped = { ...user, studioTeamMemberships: teamRows.map((team: any) => ({ teamId: team.teamId, archived: false })) };
  return LEVELS.find((candidate) => authorization.hasProjectResourceAccess(scoped, role, { ...project, memberships }, rules, candidate)) || "none";
}

function reasonFor(authorization: AuthorizationService, user: any, role: string | null, project: any, rules: any[], level: string): Reason {
  const explained = authorization.explainProjectPermission(user, role, project) as { source: string; level: string };
  if (explained.source === "account-inactive") return { kind: "inactive", label: "Account inactive" };
  if (explained.source === "workspace-role") return { kind: "admin", label: `Workspace ${role}` };
  const matching = authorization.accessRulesForTarget(rules, "project", project.id, project.id).filter((rule: any) => authorization.accessSubjectMatchesUser(rule, user, role));
  const deny = matching.find((rule: any) => rule.effect === "deny");
  if (deny) return { kind: "rule-deny", label: "Blocked by a rule", ruleId: deny.id };
  const allow = matching.filter((rule: any) => rule.effect === "allow").sort((a: any, b: any) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))[0];
  if (allow && level !== "none") return { kind: "rule-allow", label: "Granted by a rule", ruleId: allow.id };
  const scoped = authorization.accessRulesForTarget(rules, "project", project.id, project.id);
  if (level === "none" && scoped.some((rule: any) => rule.effect === "allow")) return { kind: "restricted", label: "Not on the allow list" };
  switch (explained.source) {
    case "project-membership-lead": return { kind: "lead", label: "Project lead" };
    case "project-membership": return { kind: "member", label: "On the project crew" };
    case "user-project-override": return { kind: "override", label: "Personal override" };
    case "external-collaborator-policy": return { kind: "external", label: "External collaborator" };
    case "project-bundle-ceiling": return { kind: "default", label: "Limited by project policy" };
    default: return { kind: "default", label: "Studio default" };
  }
}
