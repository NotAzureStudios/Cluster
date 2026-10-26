CREATE TABLE "StudioOffboardingCase" (
  "id" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "initiatedById" TEXT,
  "handoffUserId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "scheduledFor" TIMESTAMP(3),
  "reason" TEXT,
  "notes" TEXT,
  "equipmentStatus" TEXT NOT NULL DEFAULT 'pending',
  "equipmentEvidenceNote" TEXT,
  "equipmentEvidenceJson" TEXT NOT NULL DEFAULT '{}',
  "personnelRecordId" TEXT,
  "snapshotJson" TEXT NOT NULL DEFAULT '{}',
  "resultJson" TEXT NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioOffboardingCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudioOffboardingCase_subjectUserId_status_updatedAt_idx" ON "StudioOffboardingCase"("subjectUserId", "status", "updatedAt");
CREATE INDEX "StudioOffboardingCase_handoffUserId_status_updatedAt_idx" ON "StudioOffboardingCase"("handoffUserId", "status", "updatedAt");
CREATE INDEX "StudioOffboardingCase_status_scheduledFor_idx" ON "StudioOffboardingCase"("status", "scheduledFor");
CREATE INDEX "StudioOffboardingCase_personnelRecordId_idx" ON "StudioOffboardingCase"("personnelRecordId");
ALTER TABLE "StudioOffboardingCase" ADD CONSTRAINT "StudioOffboardingCase_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioOffboardingCase" ADD CONSTRAINT "StudioOffboardingCase_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudioOffboardingCase" ADD CONSTRAINT "StudioOffboardingCase_handoffUserId_fkey" FOREIGN KEY ("handoffUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
