const DAY_MS = 24 * 60 * 60 * 1000;

export function studioOnboardingDueAt(version: any, assignedAt: Date = new Date()) {
  const days = Number(version?.dueAfterDays || 0);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(assignedAt.getTime() + Math.floor(days) * DAY_MS);
}

export function studioOnboardingAssignmentView(assignment: any, complete: boolean, now: Date = new Date()) {
  const dueAt = assignment?.dueAt ? new Date(assignment.dueAt) : null;
  const lifecycleStatus = String(assignment?.status || "active");
  const overdue = lifecycleStatus === "active" && !complete && Boolean(dueAt && dueAt.getTime() < now.getTime());
  const state = lifecycleStatus !== "active" ? lifecycleStatus : complete ? "complete" : overdue ? "overdue" : "active";
  return {
    status: lifecycleStatus,
    state,
    dueAt: assignment?.dueAt || null,
    overdue,
    lastReminderAt: assignment?.lastReminderAt || null,
    escalatedAt: assignment?.escalatedAt || null,
    revokedAt: assignment?.revokedAt || null,
    lifecycleNote: assignment?.lifecycleNote || null,
    supersededAt: assignment?.supersededAt || null,
    supersededByVersionId: assignment?.supersededByVersionId || null,
  };
}

export async function createStudioOnboardingAssignments(prisma: any, version: any, userIds: string[], source: string, assignedAt: Date = new Date()) {
  const ids = [...new Set(userIds.map(String).filter(Boolean))];
  if (!ids.length) return { count: 0, dueAt: studioOnboardingDueAt(version, assignedAt) };
  const dueAt = studioOnboardingDueAt(version, assignedAt);
  const result = await prisma.studioOnboardingAssignment.createMany({
    data: ids.map((userId) => ({ planVersionId: version.id, userId, source, status: "active", assignedAt, dueAt })),
    skipDuplicates: true,
  });
  return { count: Number(result?.count || 0), dueAt };
}

export async function createStudioOnboardingAssignment(prisma: any, version: any, userId: string, source: string, assignedAt: Date = new Date()) {
  const existing = await prisma.studioOnboardingAssignment.findUnique({ where: { planVersionId_userId: { planVersionId: version.id, userId } } });
  if (existing) return { assignment: existing, created: false };
  const assignment = await prisma.studioOnboardingAssignment.create({
    data: { planVersionId: version.id, userId, source, status: "active", assignedAt, dueAt: studioOnboardingDueAt(version, assignedAt) },
  });
  return { assignment, created: true };
}
