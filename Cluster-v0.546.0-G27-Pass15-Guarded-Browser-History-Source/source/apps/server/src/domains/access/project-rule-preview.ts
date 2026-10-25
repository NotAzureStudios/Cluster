import type { AuthorizationService } from "./authorization.js";

/** Read-only projection through the same active Access Rule resolver used for writes.
 * This is a deliberately bounded sample, NOT a promise about unexamined users
 * or Library's independent source/folder permission layer.
 */
export async function previewProjectRuleImpact(input: {
  prisma: any;
  authorization: AuthorizationService;
  project: any;
  targetKind: string;
  targetId: string;
  subjectKind: "member" | "team" | "external" | "all";
  subjectId: string | null;
  effect: "allow" | "deny";
  level: "none" | "view" | "contribute" | "manage";
  expiresAt: string | null;
}) {
  const { prisma, authorization, project } = input;
  const SAMPLE_LIMIT = 40;
  const where: any = {
    workspaceId: project.workspaceId,
    user: { archived: false, accountState: { notIn: ["DISABLED", "SUSPENDED", "PRIVACY_ERASED"] } },
  };
  if (input.subjectKind === "member") where.userId = input.subjectId;
  let teamMemberLimitReached = false;
  if (input.subjectKind === "team") {
    // Team scope is normalized StudioTeamMember, not a profile string.
    const members = await prisma.studioTeamMember.findMany({
      where: { teamId: input.subjectId, archived: false, team: { archived: false, workspaceId: project.workspaceId } },
      select: { userId: true }, take: 1000,
    });
    teamMemberLimitReached = members.length >= 1000;
    where.userId = { in: members.map((row: any) => row.userId) };
  }
  // External is an account-type/role predicate. Scan a larger bounded window
  // before sampling; otherwise the first 40 internal accounts could yield a
  // misleading zero-person preview of a studio that has external members.
  const scanLimit = input.subjectKind === "external" ? 201 : SAMPLE_LIMIT + 1;
  const workspaceMembers = await prisma.workspaceMember.findMany({
    where, include: { user: true }, orderBy: { userId: "asc" }, take: scanLimit,
  });
  const eligible = input.subjectKind === "external"
    ? workspaceMembers.filter((row: any) => authorization.isExternalCollaboratorRole(row.user, row.role))
    : workspaceMembers;
  const sampled = teamMemberLimitReached || workspaceMembers.length >= scanLimit || eligible.length > SAMPLE_LIMIT;
  const candidates = eligible.slice(0, SAMPLE_LIMIT);
  const users = candidates.map((row: any) => row.user);
  const ids = users.map((user: any) => user.id);
  const [memberships, teamRows, activeRules] = await Promise.all([
    prisma.projectMembership.findMany({ where: { projectId: project.id, userId: { in: ids }, status: "active" } }),
    prisma.studioTeamMember.findMany({ where: { userId: { in: ids }, archived: false, team: { archived: false } }, select: { userId: true, teamId: true } }),
    prisma.accessRule.findMany({ where: { status: "active", OR: [
      { targetKind: input.targetKind, targetId: input.targetId },
      ...(input.targetKind === "project" ? [] : [{ targetKind: "project", targetId: project.id }]),
    ] } }),
  ]);
  const scopedProject = { ...project, memberships };
  const proposedRule = {
    targetKind: input.targetKind, targetId: input.targetId, projectId: project.id,
    subjectKind: input.subjectKind, subjectId: input.subjectId,
    effect: input.effect, level: input.effect === "deny" ? "none" : input.level,
    status: "active", expiresAt: input.expiresAt,
  };
  const buckets = ["none", "view", "contribute", "manage"] as const;
  const before: Record<string, number> = { none: 0, view: 0, contribute: 0, manage: 0 };
  const after: Record<string, number> = { none: 0, view: 0, contribute: 0, manage: 0 };
  let elevated = 0, reduced = 0, unchanged = 0;
  for (const member of candidates) {
    const user = { ...member.user, studioTeamMemberships: teamRows.filter((row: any) => row.userId === member.userId).map((row: any) => ({ teamId: row.teamId, archived: false })) };
    const levelFor = (rules: any[]) => {
      const check = (minimum: string) => input.targetKind === "project"
        ? authorization.hasProjectResourceAccess(user, member.role, scopedProject, rules, minimum)
        : authorization.hasTargetAccess(user, member.role, input.targetKind, input.targetId, scopedProject, rules, minimum);
      return buckets.slice().reverse().find((level) => level !== "none" && check(level)) || "none";
    };
    const current = levelFor(activeRules);
    const proposed = levelFor([...activeRules, proposedRule]);
    before[current] += 1;
    after[proposed] += 1;
    const change = buckets.indexOf(proposed) - buckets.indexOf(current);
    if (change > 0) elevated += 1;
    else if (change < 0) reduced += 1;
    else unchanged += 1;
  }
  return {
    ok: true as const, projectId: project.id,
    targetKind: input.targetKind, targetId: input.targetId,
    scope: input.targetKind === "project" ? "Project rule may inherit into child resources" : "Selected resource only",
    sampled, evaluatedCount: candidates.length, elevated, reduced, unchanged,
    before, after,
    limitations: "Bounded workspace sample only. Child-resource rules, unrelated objects, and Library source/folder policies are not simulated. The actual write is reauthorized.",
  };
}
