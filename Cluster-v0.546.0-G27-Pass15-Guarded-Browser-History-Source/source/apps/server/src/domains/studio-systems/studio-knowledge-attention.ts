// Operations summary uses full-dataset database aggregates, never a limited
// 5,000-row client projection that silently undercounts large compliance lists.
// Overdue details remain bounded, and counts are read from one DB snapshot.
export async function summarizeStudioKnowledgeAttention(prisma: any, now: Date = new Date()) {
  return prisma.$transaction(async (tx: any) => {
    const [counts, overdueCounts, overdueItems] = await Promise.all([
      tx.studioKnowledgeAssignment.groupBy({
        by: ["resourceKind", "state"],
        where: { resourceKind: { in: ["packet", "policy"] }, state: { in: ["active", "completed"] } },
        _count: { _all: true },
      }),
      tx.studioKnowledgeAssignment.groupBy({
        by: ["resourceKind"],
        where: { resourceKind: { in: ["packet", "policy"] }, state: "active", dueAt: { lt: now } },
        _count: { _all: true },
      }),
      tx.studioKnowledgeAssignment.findMany({
        where: { resourceKind: { in: ["packet", "policy"] }, state: "active", dueAt: { lt: now } },
        select: { id: true, resourceKind: true, resourceId: true, dueAt: true, cycleStartedAt: true, user: { select: { id: true, username: true, displayName: true } } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 12,
      }),
    ]);
    const getCount = (rows: any[], kind: string, state?: string) => Number(rows.find(row => row.resourceKind === kind && (!state || row.state === state))?._count?._all ?? 0);
    function summary(kind: string) {
      const active = getCount(counts, kind, "active");
      const completed = getCount(counts, kind, "completed");
      return { total: active + completed, active, completed, overdue: getCount(overdueCounts, kind) };
    }
    const packets = summary("packet");
    const policies = summary("policy");
    return { total: packets.total + policies.total, active: packets.active + policies.active, completed: packets.completed + policies.completed, overdue: packets.overdue + policies.overdue, packets, policies, overdueItems };
  }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 15_000 });
}
