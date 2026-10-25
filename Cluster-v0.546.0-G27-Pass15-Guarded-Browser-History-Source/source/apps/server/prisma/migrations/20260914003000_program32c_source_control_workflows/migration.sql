-- Program 32C: safe source-control working copies, branch policy, action receipts, and work links.

ALTER TABLE "SourceOperation"
  ADD COLUMN "workingCopyId" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "inputMetadata" TEXT NOT NULL DEFAULT '{}';

CREATE TABLE "SourceWorkingCopy" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "purpose" TEXT NOT NULL DEFAULT 'development',
  "branchName" TEXT NOT NULL,
  "baseBranch" TEXT,
  "baseRevision" TEXT,
  "headRevision" TEXT,
  "upstreamName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'preparing',
  "dirtyFiles" INTEGER NOT NULL DEFAULT 0,
  "stagedFiles" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "aheadCount" INTEGER NOT NULL DEFAULT 0,
  "behindCount" INTEGER NOT NULL DEFAULT 0,
  "mergeBaseRevision" TEXT,
  "lastScannedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceWorkingCopy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceArtifactLink" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "commitId" TEXT,
  "changeId" TEXT,
  "workingCopyId" TEXT,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "linkRole" TEXT NOT NULL DEFAULT 'implements',
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceArtifactLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceBranchPolicy" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "protectedPatterns" TEXT NOT NULL DEFAULT '[]',
  "branchPrefixes" TEXT NOT NULL DEFAULT '["feature/","fix/","hotfix/","release/"]',
  "allowDirectPush" BOOLEAN NOT NULL DEFAULT true,
  "allowForcePush" BOOLEAN NOT NULL DEFAULT false,
  "requireLinkedWorkItem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceBranchPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceOperation_repositoryId_requestKey_key" ON "SourceOperation"("repositoryId", "requestKey");
CREATE INDEX "SourceOperation_workingCopyId_createdAt_idx" ON "SourceOperation"("workingCopyId", "createdAt");
CREATE UNIQUE INDEX "SourceWorkingCopy_owner_branch" ON "SourceWorkingCopy"("repositoryId", "projectId", "ownerUserId", "branchName");
CREATE INDEX "SourceWorkingCopy_projectId_ownerUserId_archived_updatedAt_idx" ON "SourceWorkingCopy"("projectId", "ownerUserId", "archived", "updatedAt");
CREATE INDEX "SourceWorkingCopy_repositoryId_branchName_archived_idx" ON "SourceWorkingCopy"("repositoryId", "branchName", "archived");
CREATE INDEX "SourceWorkingCopy_status_lastScannedAt_idx" ON "SourceWorkingCopy"("status", "lastScannedAt");
CREATE INDEX "SourceArtifactLink_projectId_targetType_targetId_createdAt_idx" ON "SourceArtifactLink"("projectId", "targetType", "targetId", "createdAt");
CREATE INDEX "SourceArtifactLink_repositoryId_commitId_createdAt_idx" ON "SourceArtifactLink"("repositoryId", "commitId", "createdAt");
CREATE INDEX "SourceArtifactLink_changeId_idx" ON "SourceArtifactLink"("changeId");
CREATE INDEX "SourceArtifactLink_workingCopyId_createdAt_idx" ON "SourceArtifactLink"("workingCopyId", "createdAt");
CREATE UNIQUE INDEX "SourceBranchPolicy_bindingId_key" ON "SourceBranchPolicy"("bindingId");
CREATE INDEX "SourceBranchPolicy_allowDirectPush_requireLinkedWorkItem_idx" ON "SourceBranchPolicy"("allowDirectPush", "requireLinkedWorkItem");

ALTER TABLE "SourceOperation" ADD CONSTRAINT "SourceOperation_workingCopyId_fkey" FOREIGN KEY ("workingCopyId") REFERENCES "SourceWorkingCopy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceWorkingCopy" ADD CONSTRAINT "SourceWorkingCopy_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceWorkingCopy" ADD CONSTRAINT "SourceWorkingCopy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceArtifactLink" ADD CONSTRAINT "SourceArtifactLink_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceArtifactLink" ADD CONSTRAINT "SourceArtifactLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceArtifactLink" ADD CONSTRAINT "SourceArtifactLink_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "SourceCommit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceArtifactLink" ADD CONSTRAINT "SourceArtifactLink_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "SourceChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceArtifactLink" ADD CONSTRAINT "SourceArtifactLink_workingCopyId_fkey" FOREIGN KEY ("workingCopyId") REFERENCES "SourceWorkingCopy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceBranchPolicy" ADD CONSTRAINT "SourceBranchPolicy_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ProjectSourceBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
