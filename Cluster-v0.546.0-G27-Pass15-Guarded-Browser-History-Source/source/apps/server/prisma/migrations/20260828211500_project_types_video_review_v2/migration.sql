ALTER TABLE "VideoAsset"
  ADD COLUMN "versionGroupId" TEXT,
  ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reviewRound" TEXT,
  ADD COLUMN "assetKind" TEXT NOT NULL DEFAULT 'source',
  ADD COLUMN "proxyOfId" TEXT,
  ADD COLUMN "approvalState" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "frameRate" DOUBLE PRECISION,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "codec" TEXT,
  ADD COLUMN "metadata" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "VideoComment"
  ADD COLUMN "endTimecodeSeconds" DOUBLE PRECISION,
  ADD COLUMN "frameNumber" INTEGER,
  ADD COLUMN "annotation" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "assigneeId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedById" TEXT;

UPDATE "VideoAsset" SET "versionGroupId" = "id" WHERE "versionGroupId" IS NULL;

CREATE INDEX "VideoAsset_projectId_versionGroupId_versionNumber_idx" ON "VideoAsset"("projectId", "versionGroupId", "versionNumber");
CREATE INDEX "VideoAsset_projectId_assetKind_status_idx" ON "VideoAsset"("projectId", "assetKind", "status");
CREATE INDEX "VideoComment_videoAssetId_status_timecodeSeconds_idx" ON "VideoComment"("videoAssetId", "status", "timecodeSeconds");
CREATE INDEX "VideoComment_assigneeId_status_idx" ON "VideoComment"("assigneeId", "status");
