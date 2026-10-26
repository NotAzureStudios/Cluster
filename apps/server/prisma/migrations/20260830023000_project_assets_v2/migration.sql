ALTER TABLE "ProjectFile"
  ADD COLUMN "assetRole" TEXT NOT NULL DEFAULT 'source',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "tags" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "metadata" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "versionGroupId" TEXT,
  ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "versionLabel" TEXT,
  ADD COLUMN "derivedFromId" TEXT,
  ADD COLUMN "proxyOfId" TEXT,
  ADD COLUMN "exportOfId" TEXT,
  ADD COLUMN "supersededById" TEXT,
  ADD COLUMN "duplicateOfId" TEXT,
  ADD COLUMN "checksumSha256" TEXT,
  ADD COLUMN "lockedById" TEXT,
  ADD COLUMN "lockExpiresAt" TIMESTAMP(3),
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "ProjectFile" SET "versionGroupId" = "id" WHERE "versionGroupId" IS NULL;

CREATE INDEX "ProjectFile_projectId_archived_updatedAt_idx" ON "ProjectFile"("projectId", "archived", "updatedAt");
CREATE INDEX "ProjectFile_projectId_category_assetRole_idx" ON "ProjectFile"("projectId", "category", "assetRole");
CREATE INDEX "ProjectFile_projectId_versionGroupId_versionNumber_idx" ON "ProjectFile"("projectId", "versionGroupId", "versionNumber");
CREATE INDEX "ProjectFile_projectId_checksumSha256_idx" ON "ProjectFile"("projectId", "checksumSha256");
CREATE INDEX "ProjectFile_projectId_status_updatedAt_idx" ON "ProjectFile"("projectId", "status", "updatedAt");
CREATE INDEX "ProjectFile_lockedById_lockExpiresAt_idx" ON "ProjectFile"("lockedById", "lockExpiresAt");
