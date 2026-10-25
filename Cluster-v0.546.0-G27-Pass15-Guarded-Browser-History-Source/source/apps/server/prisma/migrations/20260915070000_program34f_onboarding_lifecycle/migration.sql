ALTER TABLE "StudioOnboardingPlanVersion"
  ADD COLUMN "dueAfterDays" INTEGER,
  ADD COLUMN "reminderDaysBefore" INTEGER,
  ADD COLUMN "escalationDaysAfter" INTEGER;

ALTER TABLE "StudioOnboardingAssignment"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "lifecycleNote" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "supersededByVersionId" TEXT;

DROP INDEX "StudioOnboardingAssignment_userId_assignedAt_idx";
DROP INDEX "StudioOnboardingAssignment_planVersionId_assignedAt_idx";
CREATE INDEX "StudioOnboardingAssignment_userId_status_dueAt_idx" ON "StudioOnboardingAssignment"("userId", "status", "dueAt");
CREATE INDEX "StudioOnboardingAssignment_planVersionId_status_assignedAt_idx" ON "StudioOnboardingAssignment"("planVersionId", "status", "assignedAt");
CREATE INDEX "StudioOnboardingAssignment_status_dueAt_idx" ON "StudioOnboardingAssignment"("status", "dueAt");
ALTER TABLE "StudioOnboardingAssignment" ADD CONSTRAINT "StudioOnboardingAssignment_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudioOnboardingAssignment" ADD CONSTRAINT "StudioOnboardingAssignment_supersededByVersionId_fkey" FOREIGN KEY ("supersededByVersionId") REFERENCES "StudioOnboardingPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
