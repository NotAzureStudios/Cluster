import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";
export class PeopleGovernanceError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, statusCode = 409, details?: Record<string, unknown>) {
    super(message);
    this.name = "PeopleGovernanceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function advisoryLock(tx: any, key: string) {
  await acquireTransactionAdvisoryLock(tx, key);
}

export async function lockPeopleProfile(tx: any, userId: string) {
  await advisoryLock(tx, `cluster-people-profile:${userId}`);
}

export async function lockPeopleTeam(tx: any, teamId: string) {
  await advisoryLock(tx, `cluster-people-team:${teamId}`);
}

export async function lockPeopleUsers(tx: any, userIds: Iterable<string>) {
  const ids = [...new Set([...userIds].map(String).filter(Boolean))].sort();
  for (const userId of ids) await advisoryLock(tx, `cluster-people-team-user:${userId}`);
}

/**
 * Manager relationships are a small workspace graph. A single graph lock keeps
 * concurrent A→B / B→C / C→A writes from independently passing cycle checks.
 */
export async function validateManagerAssignment(tx: any, userId: string, managerUserId: string | null | undefined, workspaceId?: string) {
  await advisoryLock(tx, "cluster-people-manager-graph");
  if (!managerUserId) return null;
  if (managerUserId === userId) throw new PeopleGovernanceError("MANAGER_SELF_REFERENCE", "A person cannot manage themselves.", 400);
  const manager = await tx.user.findFirst({
    where: { id: managerUserId, archived: false, ...(workspaceId ? { memberships: { some: { workspaceId } } } : {}) },
    select: { id: true, username: true, displayName: true, preferredName: true, employment: { select: { managerUserId: true } } },
  });
  if (!manager) throw new PeopleGovernanceError("MANAGER_INVALID", "Choose an active manager.", 400);

  const visited = new Set<string>([userId]);
  let cursor: { id: string; managerUserId: string | null } | null = { id: manager.id, managerUserId: manager.employment?.managerUserId || null };
  let depth = 0;
  while (cursor && depth < 256) {
    if (visited.has(cursor.id)) throw new PeopleGovernanceError("MANAGER_CYCLE", "That manager assignment would create a reporting cycle.", 409, { managerUserId });
    visited.add(cursor.id);
    if (!cursor.managerUserId) break;
    const next: { id: string; employment?: { managerUserId?: string | null } | null } | null = await tx.user.findUnique({ where: { id: cursor.managerUserId }, select: { id: true, employment: { select: { managerUserId: true } } } });
    cursor = next ? { id: next.id, managerUserId: next.employment?.managerUserId || null } : null;
    depth += 1;
  }
  if (depth >= 256) throw new PeopleGovernanceError("MANAGER_GRAPH_LIMIT", "The reporting chain is too deep to update safely.", 409);
  return manager;
}

export async function validateTeamAllocations(tx: any, teamId: string, members: Array<{ userId: string; allocationPercent: number }>, hardLimit = 200) {
  const incoming = new Map(members.map((member) => [member.userId, Number(member.allocationPercent || 0)]));
  if (!incoming.size) return new Map<string, number>();
  const otherMemberships = await tx.studioTeamMember.findMany({
    where: { userId: { in: [...incoming.keys()] }, teamId: { not: teamId }, archived: false, team: { archived: false } },
    select: { userId: true, allocationPercent: true },
  });
  const totals = new Map<string, number>();
  for (const [userId, allocation] of incoming) totals.set(userId, allocation);
  for (const membership of otherMemberships) totals.set(membership.userId, (totals.get(membership.userId) || 0) + Number(membership.allocationPercent || 0));
  const violation = [...totals.entries()].find(([, total]) => total > hardLimit);
  if (violation) throw new PeopleGovernanceError("TEAM_ALLOCATION_LIMIT", `Team allocations cannot exceed ${hardLimit}% for one person.`, 409, { userId: violation[0], allocationPercent: violation[1], hardLimit });
  return totals;
}
