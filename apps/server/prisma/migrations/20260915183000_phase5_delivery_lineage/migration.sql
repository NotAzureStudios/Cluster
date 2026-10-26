-- Phase 5: first-class delivery lineage. Cluster has no active production instances,
-- so Builds/QA/Release move cleanly away from generic persistence without dual-write compatibility.
CREATE TABLE "DeliveryBuild" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "lane" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'internal',
  "buildNumber" TEXT,
  "sourceRepositoryId" TEXT NOT NULL,
  "sourceCommitId" TEXT NOT NULL,
  "sourceReviewId" TEXT,
  "sourceBranch" TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "sourceSnapshot" TEXT NOT NULL DEFAULT '{}',
  "previousBuildId" TEXT,
  "changeSummary" TEXT NOT NULL DEFAULT '{}',
  "artifactUrl" TEXT NOT NULL DEFAULT '',
  "changelog" TEXT NOT NULL DEFAULT '',
  "qaStatus" TEXT NOT NULL DEFAULT 'untested',
  "approval" TEXT NOT NULL DEFAULT 'draft',
  "createdBy" TEXT,
  "createdById" TEXT,
  "ownerId" TEXT,
  "reviewerIds" TEXT NOT NULL DEFAULT '[]',
  "fileSize" TEXT,
  "checksum" TEXT,
  "signed" BOOLEAN NOT NULL DEFAULT false,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "promotedAt" TIMESTAMP(3),
  "testedPlatforms" TEXT NOT NULL DEFAULT '[]',
  "expiresAt" TIMESTAMP(3),
  "platformKey" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DeliveryBuild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryQaPlan" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "buildId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "configuration" TEXT NOT NULL DEFAULT 'default',
  "suite" TEXT NOT NULL DEFAULT 'general',
  "environment" TEXT NOT NULL DEFAULT '',
  "dueDate" TIMESTAMP(3),
  "template" TEXT NOT NULL DEFAULT 'custom',
  "owner" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT,
  "testerIds" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "cases" TEXT NOT NULL DEFAULT '[]',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DeliveryQaPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryQaSession" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "buildId" TEXT NOT NULL,
  "planId" TEXT,
  "retestOfSessionId" TEXT,
  "regressionBaseBuildId" TEXT,
  "platform" TEXT NOT NULL,
  "configuration" TEXT NOT NULL DEFAULT 'default',
  "suite" TEXT NOT NULL DEFAULT 'general',
  "environment" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "owner" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT,
  "testerIds" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "decision" TEXT NOT NULL DEFAULT 'pending',
  "passed" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "blocked" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "signedOffBy" TEXT,
  "signedOffById" TEXT,
  "signedOffAt" TIMESTAMP(3),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DeliveryQaSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryRelease" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "buildId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "features" TEXT NOT NULL DEFAULT '[]',
  "fixes" TEXT NOT NULL DEFAULT '[]',
  "knownIssues" TEXT NOT NULL DEFAULT '[]',
  "body" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DeliveryRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryBuild_projectId_version_platform_createdAt_idx" ON "DeliveryBuild"("projectId", "version", "platform", "createdAt");
CREATE INDEX "DeliveryBuild_projectId_archived_createdAt_idx" ON "DeliveryBuild"("projectId", "archived", "createdAt");
CREATE INDEX "DeliveryBuild_projectId_channel_qaStatus_approval_idx" ON "DeliveryBuild"("projectId", "channel", "qaStatus", "approval");
CREATE INDEX "DeliveryBuild_sourceRepositoryId_sourceRevision_idx" ON "DeliveryBuild"("sourceRepositoryId", "sourceRevision");
CREATE INDEX "DeliveryBuild_sourceReviewId_idx" ON "DeliveryBuild"("sourceReviewId");
CREATE INDEX "DeliveryBuild_previousBuildId_idx" ON "DeliveryBuild"("previousBuildId");
CREATE INDEX "DeliveryQaPlan_projectId_archived_updatedAt_idx" ON "DeliveryQaPlan"("projectId", "archived", "updatedAt");
CREATE INDEX "DeliveryQaPlan_buildId_status_idx" ON "DeliveryQaPlan"("buildId", "status");
CREATE INDEX "DeliveryQaPlan_projectId_platform_configuration_suite_idx" ON "DeliveryQaPlan"("projectId", "platform", "configuration", "suite");
CREATE INDEX "DeliveryQaSession_projectId_archived_updatedAt_idx" ON "DeliveryQaSession"("projectId", "archived", "updatedAt");
CREATE INDEX "DeliveryQaSession_buildId_status_decision_idx" ON "DeliveryQaSession"("buildId", "status", "decision");
CREATE INDEX "DeliveryQaSession_planId_status_idx" ON "DeliveryQaSession"("planId", "status");
CREATE INDEX "DeliveryQaSession_retestOfSessionId_idx" ON "DeliveryQaSession"("retestOfSessionId");
CREATE INDEX "DeliveryQaSession_regressionBaseBuildId_idx" ON "DeliveryQaSession"("regressionBaseBuildId");
CREATE INDEX "DeliveryQaSession_projectId_platform_configuration_suite_status_idx" ON "DeliveryQaSession"("projectId", "platform", "configuration", "suite", "status");
CREATE INDEX "DeliveryRelease_projectId_archived_updatedAt_idx" ON "DeliveryRelease"("projectId", "archived", "updatedAt");
CREATE INDEX "DeliveryRelease_buildId_status_idx" ON "DeliveryRelease"("buildId", "status");
CREATE INDEX "DeliveryRelease_projectId_status_publishedAt_idx" ON "DeliveryRelease"("projectId", "status", "publishedAt");

ALTER TABLE "DeliveryBuild" ADD CONSTRAINT "DeliveryBuild_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryBuild" ADD CONSTRAINT "DeliveryBuild_sourceRepositoryId_fkey" FOREIGN KEY ("sourceRepositoryId") REFERENCES "SourceRepository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryBuild" ADD CONSTRAINT "DeliveryBuild_sourceCommitId_fkey" FOREIGN KEY ("sourceCommitId") REFERENCES "SourceCommit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryBuild" ADD CONSTRAINT "DeliveryBuild_sourceReviewId_fkey" FOREIGN KEY ("sourceReviewId") REFERENCES "SourceReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryBuild" ADD CONSTRAINT "DeliveryBuild_previousBuildId_fkey" FOREIGN KEY ("previousBuildId") REFERENCES "DeliveryBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaPlan" ADD CONSTRAINT "DeliveryQaPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaPlan" ADD CONSTRAINT "DeliveryQaPlan_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "DeliveryBuild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaSession" ADD CONSTRAINT "DeliveryQaSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaSession" ADD CONSTRAINT "DeliveryQaSession_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "DeliveryBuild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaSession" ADD CONSTRAINT "DeliveryQaSession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DeliveryQaPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaSession" ADD CONSTRAINT "DeliveryQaSession_retestOfSessionId_fkey" FOREIGN KEY ("retestOfSessionId") REFERENCES "DeliveryQaSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryQaSession" ADD CONSTRAINT "DeliveryQaSession_regressionBaseBuildId_fkey" FOREIGN KEY ("regressionBaseBuildId") REFERENCES "DeliveryBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryRelease" ADD CONSTRAINT "DeliveryRelease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryRelease" ADD CONSTRAINT "DeliveryRelease_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "DeliveryBuild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
