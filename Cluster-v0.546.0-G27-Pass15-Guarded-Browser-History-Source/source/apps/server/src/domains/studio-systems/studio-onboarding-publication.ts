import { createStudioOnboardingAssignments } from "./studio-onboarding-runtime.js";

/** A version is published only if every initial assignment and supersession commits. */
export async function commitStudioOnboardingPublication(
  prisma: any,
  { planId, body, resolved, userIds, publishedAt }: {
    planId: string;
    body: { versionLabel: string; publish: boolean; dueAfterDays?: number | null; reminderDaysBefore?: number | null; escalationDaysAfter?: number | null; supersedePreviousAssignments: boolean };
    resolved: Array<{position:number;kind:string;resourceId:string;resourceLabel:string;resourceVersionLabel?:string|null;required:boolean}>;
    userIds: string[];
    publishedAt: Date | null;
  },
) {
  return prisma.$transaction(async (tx: any) => {
      // Serializes competing publishers for the same Plan. A failed assignment must not
      // leave a published version with zero assigned people and an unrepeatable label.
      await tx.$queryRaw`SELECT "id" FROM "StudioOnboardingPlan" WHERE "id" = ${planId} FOR UPDATE`;
      const latest = await tx.studioOnboardingPlanVersion.findFirst({ where: { planId }, orderBy: { version: "desc" }, select: { version: true } });
      const version = Number(latest?.version || 0) + 1;
      const created = await tx.studioOnboardingPlanVersion.create({ data: {
        planId, version, versionLabel: body.versionLabel,
        status: body.publish ? "published" : "draft", publishedAt,
        dueAfterDays: body.dueAfterDays ?? null,
        reminderDaysBefore: body.reminderDaysBefore ?? null,
        escalationDaysAfter: body.escalationDaysAfter ?? null,
        steps: { create: resolved.map((step) => ({ position: step.position, kind: step.kind, resourceId: step.resourceId, resourceLabel: step.resourceLabel, resourceVersionLabel: step.resourceVersionLabel, required: step.required })) },
      }, include: { steps: { orderBy: { position: "asc" } }, _count: { select: { assignments: true } } } });
      let assigned = 0;
      let superseded = 0;
      if (body.publish) {
        const assignments = await createStudioOnboardingAssignments(tx, created, userIds, "publish", publishedAt || new Date());
        assigned = assignments.count;
        if (body.supersedePreviousAssignments && userIds.length) {
          const older = await tx.studioOnboardingPlanVersion.findMany({ where: { planId, id: { not: created.id } }, select: { id: true } });
          const oldIds = older.map((item: any) => String(item.id));
          if (oldIds.length) superseded = (await tx.studioOnboardingAssignment.updateMany({
            where: { planVersionId: { in: oldIds }, userId: { in: userIds }, status: "active" },
            data: { status: "superseded", supersededAt: publishedAt || new Date(), supersededByVersionId: created.id },
          })).count;
        }
        await tx.studioOnboardingPlan.update({ where: { id: planId }, data: { status: "active" } });
      }
      return { created, assigned, superseded };
  }, { timeout: 15_000 });
}
