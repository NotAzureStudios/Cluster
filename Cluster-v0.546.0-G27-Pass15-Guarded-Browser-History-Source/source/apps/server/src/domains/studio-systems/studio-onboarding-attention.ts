import { completionStateForUsers } from "./studio-onboarding-routes.js";
import { studioOnboardingAssignmentView } from "./studio-onboarding-runtime.js";

// The same Packet/Policy/Form evidence resolver used by the member checklist
// drives the administrator projection. Counts of raw active assignment rows are
// NOT counts of work still due. Read the entire bounded population in a single
// database snapshot; incomplete scans fail visibly rather than undercounting.
export async function summarizeStudioOnboardingAttention(prisma: any, now: Date = new Date(), options: { pageSize?: number; maxAssignments?: number } = {}) {
  const pageSize = Math.min(500, Math.max(1, options.pageSize ?? 200));
  const maxAssignments = Math.max(pageSize, options.maxAssignments ?? 25_000);
  return prisma.$transaction(async (tx: any) => {
    const result = { assigned: 0, active: 0, completed: 0, overdue: 0, dueSoon: 0, overdueItems: [] as Array<{ assignmentId: string; userId: string; planTitle: string; dueAt: Date }> };
    const versions = new Map<string, any>();
    let cursor: string | undefined;
    let scanned = 0;
    for (;;) {
      const batch: any[] = await tx.studioOnboardingAssignment.findMany({
        where: { status: "active" },
        select: { id: true, userId: true, planVersionId: true, dueAt: true },
        orderBy: { id: "asc" }, take: pageSize + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length > pageSize && scanned + pageSize >= maxAssignments) {
        throw Object.assign(new Error("Onboarding summary exceeded its safe scan limit; narrow the report before relying on counts."), { code: "ONBOARDING_SUMMARY_LIMIT" });
      }
      const rows = batch.slice(0, pageSize);
      if (!rows.length) break;
      scanned += rows.length;
      // Some assignments remain active after their plan is unpublished; those
      // are not currently actionable in the member onboarding experience.
      const groups = new Map<string, any[]>();
      for (const row of rows) {
        if (!groups.has(row.planVersionId)) groups.set(row.planVersionId, []);
        groups.get(row.planVersionId)!.push(row);
      }
      for (const [versionId, assignments] of groups) {
        if (!versions.has(versionId)) {
          const version = await tx.studioOnboardingPlanVersion.findUnique({
            where: { id: versionId },
            select: { id: true, status: true, plan: { select: { status: true, title: true } }, steps: { select: { id: true, kind: true, resourceId: true, required: true }, orderBy: { position: "asc" } } },
          });
          if (!version) throw Object.assign(new Error("Onboarding plan version is missing."), { code: "ONBOARDING_VERSION_MISSING" });
          versions.set(versionId, version);
        }
        const version = versions.get(versionId)!;
        if (version.status !== "published" || version.plan.status !== "active") continue;
        const states = await completionStateForUsers(tx, assignments.map((item: any) => item.userId), version.steps);
        for (const assignment of assignments) {
          result.assigned++;
          const statesForPerson = states.get(assignment.userId) || [];
          const done = statesForPerson.filter((step: any) => step.required).every((step: any) => step.complete);
          const lifecycle = studioOnboardingAssignmentView(assignment, done, now);
          if (done) { result.completed++; continue; }
          result.active++;
          if (lifecycle.overdue) {
            result.overdue++;
            result.overdueItems.push({ assignmentId: assignment.id, userId: assignment.userId, planTitle: version.plan.title, dueAt: assignment.dueAt });
            result.overdueItems.sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt) || a.assignmentId.localeCompare(b.assignmentId));
            if (result.overdueItems.length > 12) result.overdueItems.pop();
          } else if (assignment.dueAt && new Date(assignment.dueAt).getTime() <= now.getTime() + 7 * 86_400_000) result.dueSoon++;
        }
      }
      if (batch.length <= pageSize) break;
      cursor = rows[rows.length - 1].id;
    }
    result.overdueItems.sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
    return result;
  }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 25_000 });
}
