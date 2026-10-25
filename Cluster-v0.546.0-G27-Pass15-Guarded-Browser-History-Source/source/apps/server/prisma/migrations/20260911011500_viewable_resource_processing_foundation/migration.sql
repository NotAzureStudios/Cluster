ALTER TABLE "ReviewAsset"
  ADD COLUMN "checksumSha256" TEXT;

ALTER TABLE "AssetArtifact"
  ADD COLUMN "variantKey" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "sourceChecksumSha256" TEXT,
  ADD COLUMN "generatedByJobId" TEXT,
  ADD COLUMN "toolchain" TEXT NOT NULL DEFAULT '{}';

DROP INDEX IF EXISTS "AssetArtifact_reviewAssetId_kind_key";
CREATE UNIQUE INDEX "AssetArtifact_reviewAssetId_kind_variantKey_key" ON "AssetArtifact"("reviewAssetId", "kind", "variantKey");
CREATE INDEX "AssetArtifact_reviewAssetId_kind_idx" ON "AssetArtifact"("reviewAssetId", "kind");

ALTER TABLE "MediaWorkerHeartbeat"
  ADD COLUMN "toolVersions" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "resourceBudgets" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "MediaProcessingPolicy"
  ADD COLUMN "medium" TEXT NOT NULL DEFAULT 'video';

DROP INDEX IF EXISTS "MediaProcessingPolicy_projectType_assetRole_key";
DROP INDEX IF EXISTS "MediaProcessingPolicy_enabled_projectType_idx";
CREATE UNIQUE INDEX "MediaProcessingPolicy_projectType_medium_assetRole_key" ON "MediaProcessingPolicy"("projectType", "medium", "assetRole");
CREATE INDEX "MediaProcessingPolicy_enabled_projectType_medium_idx" ON "MediaProcessingPolicy"("enabled", "projectType", "medium");
