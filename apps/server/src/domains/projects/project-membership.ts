import { requireClusterProjectRole } from "@cluster/shared";

export type ProjectMembershipShape = {
  userId: string;
  roleKey?: string | null;
  roleLabel?: string | null;
  allocationPercent?: number | null;
  accessLevel?: string | null;
  isLead?: boolean | null;
  status?: string | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
};

export function activeProjectMemberships(project: any, now = new Date()): ProjectMembershipShape[] {
  const rows = Array.isArray(project?.memberships) ? project.memberships : [];
  return rows.filter((row: ProjectMembershipShape) => {
    if (String(row.status || "active") !== "active") return false;
    const starts = row.startsAt ? new Date(row.startsAt).getTime() : null;
    const ends = row.endsAt ? new Date(row.endsAt).getTime() : null;
    if (starts && Number.isFinite(starts) && starts > now.getTime()) return false;
    if (ends && Number.isFinite(ends) && ends <= now.getTime()) return false;
    return true;
  });
}

export function projectMembershipForUser(project: any, userId: string | null | undefined) {
  if (!userId) return null;
  return activeProjectMemberships(project).find((row) => row.userId === userId) || null;
}

export function membershipIsLead(membership: ProjectMembershipShape | null | undefined) {
  return Boolean(membership?.isLead || membership?.roleKey === "lead");
}

export type ReplaceProjectMembershipsInput = {
  projectId: string;
  memberIds: string[];
  leadId: string;
  roleLabels?: Record<string, string>;
  defaultAllocationPercent?: number;
};

/**
 * Use the caller's transaction for Project header + crew updates. Validation
 * runs before the first write so malformed roles never mutate the header.
 */
export async function writeProjectMembershipsInTransaction(tx: any, input: ReplaceProjectMembershipsInput) {
  const memberIds = Array.from(new Set(input.memberIds.filter(Boolean)));
  if (!memberIds.includes(input.leadId)) memberIds.unshift(input.leadId);
  const rows = memberIds.map((userId) => {
    const isLead = userId === input.leadId;
    const requested = requireClusterProjectRole(input.roleLabels?.[userId] || "contributor");
    const role = requireClusterProjectRole(isLead ? "lead" : requested.key === "lead" ? "contributor" : requested.key);
    return { userId, isLead, role };
  });
  await tx.projectMembership.updateMany({ where: { projectId: input.projectId, userId: { notIn: memberIds }, status: "active" }, data: { status: "inactive", endsAt: new Date() } });
  for (const { userId, isLead, role } of rows) {
    await tx.projectMembership.upsert({
      where: { projectId_userId: { projectId: input.projectId, userId } },
      update: { roleKey: role.key, roleLabel: role.label, isLead, accessLevel: role.accessLevel, status: "active", endsAt: null },
      create: { projectId: input.projectId, userId, roleKey: role.key, roleLabel: role.label, isLead, accessLevel: role.accessLevel, allocationPercent: input.defaultAllocationPercent ?? 100, status: "active" },
    });
  }
}

/** Standalone crew replacement for callers without a Project header update. */
export async function replaceProjectMemberships(prisma: any, input: ReplaceProjectMembershipsInput) {
  await prisma.$transaction((tx: any) => writeProjectMembershipsInTransaction(tx, input));
  return prisma.projectMembership.findMany({
    where: { projectId: input.projectId, status: "active" },
    orderBy: [{ isLead: "desc" }, { createdAt: "asc" }],
  });
}
