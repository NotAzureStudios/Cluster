CREATE TABLE "StudioOnboardingPlan" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "audienceJson" TEXT NOT NULL DEFAULT '{"mode":"all","targets":[]}',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioOnboardingPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioOnboardingPlan_key_key" ON "StudioOnboardingPlan"("key");
CREATE INDEX "StudioOnboardingPlan_status_updatedAt_idx" ON "StudioOnboardingPlan"("status", "updatedAt");

CREATE TABLE "StudioOnboardingPlanVersion" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "versionLabel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioOnboardingPlanVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioOnboardingPlanVersion_planId_version_key" ON "StudioOnboardingPlanVersion"("planId", "version");
CREATE UNIQUE INDEX "StudioOnboardingPlanVersion_planId_versionLabel_key" ON "StudioOnboardingPlanVersion"("planId", "versionLabel");
CREATE INDEX "StudioOnboardingPlanVersion_planId_status_publishedAt_idx" ON "StudioOnboardingPlanVersion"("planId", "status", "publishedAt");
ALTER TABLE "StudioOnboardingPlanVersion" ADD CONSTRAINT "StudioOnboardingPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudioOnboardingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudioOnboardingStep" (
  "id" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resourceLabel" TEXT NOT NULL,
  "resourceVersionLabel" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioOnboardingStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioOnboardingStep_planVersionId_position_key" ON "StudioOnboardingStep"("planVersionId", "position");
CREATE INDEX "StudioOnboardingStep_kind_resourceId_idx" ON "StudioOnboardingStep"("kind", "resourceId");
ALTER TABLE "StudioOnboardingStep" ADD CONSTRAINT "StudioOnboardingStep_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "StudioOnboardingPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudioOnboardingAssignment" (
  "id" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'publish',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioOnboardingAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioOnboardingAssignment_planVersionId_userId_key" ON "StudioOnboardingAssignment"("planVersionId", "userId");
CREATE INDEX "StudioOnboardingAssignment_userId_assignedAt_idx" ON "StudioOnboardingAssignment"("userId", "assignedAt");
CREATE INDEX "StudioOnboardingAssignment_planVersionId_assignedAt_idx" ON "StudioOnboardingAssignment"("planVersionId", "assignedAt");
ALTER TABLE "StudioOnboardingAssignment" ADD CONSTRAINT "StudioOnboardingAssignment_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "StudioOnboardingPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioOnboardingAssignment" ADD CONSTRAINT "StudioOnboardingAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
