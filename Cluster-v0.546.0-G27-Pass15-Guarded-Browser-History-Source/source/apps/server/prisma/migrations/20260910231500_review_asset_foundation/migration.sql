-- Block 29A: canonical, media-independent review domain.
ALTER TABLE "VideoAsset" RENAME TO "ReviewAsset";
ALTER TABLE "VideoComment" RENAME TO "ReviewComment";
ALTER TABLE "MediaArtifact" RENAME TO "AssetArtifact";

ALTER TABLE "ReviewComment" RENAME COLUMN "videoAssetId" TO "reviewAssetId";
ALTER TABLE "ReviewComment" RENAME COLUMN "carriedFromVideoId" TO "carriedFromAssetId";
ALTER TABLE "AssetArtifact" RENAME COLUMN "videoAssetId" TO "reviewAssetId";

-- Keep database constraint/index identity aligned with the new canonical schema.
ALTER TABLE "ReviewAsset" RENAME CONSTRAINT "VideoAsset_pkey" TO "ReviewAsset_pkey";
ALTER TABLE "ReviewAsset" RENAME CONSTRAINT "VideoAsset_projectId_fkey" TO "ReviewAsset_projectId_fkey";
ALTER TABLE "ReviewComment" RENAME CONSTRAINT "VideoComment_pkey" TO "ReviewComment_pkey";
ALTER TABLE "ReviewComment" RENAME CONSTRAINT "VideoComment_videoAssetId_fkey" TO "ReviewComment_reviewAssetId_fkey";
ALTER TABLE "ReviewComment" RENAME CONSTRAINT "VideoComment_userId_fkey" TO "ReviewComment_userId_fkey";
ALTER TABLE "AssetArtifact" RENAME CONSTRAINT "MediaArtifact_pkey" TO "AssetArtifact_pkey";
ALTER TABLE "AssetArtifact" RENAME CONSTRAINT "MediaArtifact_videoAssetId_fkey" TO "AssetArtifact_reviewAssetId_fkey";

ALTER INDEX "VideoAsset_pool_idx" RENAME TO "ReviewAsset_pool_idx";
ALTER INDEX "VideoAsset_status_idx" RENAME TO "ReviewAsset_status_idx";
ALTER INDEX "VideoAsset_projectId_versionGroupId_versionNumber_idx" RENAME TO "ReviewAsset_projectId_versionGroupId_versionNumber_idx";
ALTER INDEX "VideoAsset_projectId_assetKind_status_idx" RENAME TO "ReviewAsset_projectId_assetKind_status_idx";
ALTER INDEX "VideoAsset_projectId_derivedFromId_idx" RENAME TO "ReviewAsset_projectId_derivedFromId_idx";
ALTER INDEX "VideoAsset_projectId_supersededById_idx" RENAME TO "ReviewAsset_projectId_supersededById_idx";
ALTER INDEX "VideoAsset_projectId_processingState_updatedAt_idx" RENAME TO "ReviewAsset_projectId_processingState_updatedAt_idx";
ALTER INDEX "VideoAsset_status_updatedAt_idx" RENAME TO "ReviewAsset_status_updatedAt_idx";
ALTER INDEX "VideoComment_assigneeId_status_idx" RENAME TO "ReviewComment_assigneeId_status_idx";

DROP INDEX IF EXISTS "VideoAsset_projectId_idx";
DROP INDEX IF EXISTS "VideoAsset_projectId_updatedAt_idx";

ALTER TABLE "ReviewAsset"
  ADD COLUMN "medium" TEXT NOT NULL DEFAULT 'video',
  ADD COLUMN "creatorId" TEXT,
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "lastModifiedById" TEXT,
  ADD COLUMN "sensitiveMetadata" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "metadataProvenance" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "fileCreatedAt" TIMESTAMP(3),
  ADD COLUMN "capturedAt" TIMESTAMP(3),
  ADD COLUMN "modifiedAt" TIMESTAMP(3),
  ADD COLUMN "versionUploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "AssetArtifact"
  ADD COLUMN "metadataPolicy" TEXT NOT NULL DEFAULT 'preserve',
  ADD COLUMN "derivativeGeneratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ReviewComment"
  ADD COLUMN "locatorType" TEXT NOT NULL DEFAULT 'media_time',
  ADD COLUMN "locator" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ReviewComment"
SET "locator" = jsonb_strip_nulls(jsonb_build_object(
  'type', 'media_time',
  'timeSeconds', "timecodeSeconds",
  'endTimeSeconds', "endTimecodeSeconds",
  'frameNumber', "frameNumber",
  'annotation', CASE WHEN COALESCE("annotation", '') = '' THEN NULL ELSE "annotation"::jsonb END
))::text;

ALTER TABLE "ReviewComment"
  DROP COLUMN "timecodeSeconds",
  DROP COLUMN "endTimecodeSeconds",
  DROP COLUMN "frameNumber",
  DROP COLUMN "annotation";

DROP INDEX IF EXISTS "VideoComment_videoAssetId_idx";
DROP INDEX IF EXISTS "VideoComment_videoAssetId_status_timecodeSeconds_idx";
DROP INDEX IF EXISTS "VideoComment_videoAssetId_workEntityType_workEntityId_idx";
DROP INDEX IF EXISTS "VideoComment_carriedFromVideoId_carriedFromCommentId_idx";
DROP INDEX IF EXISTS "VideoComment_timecodeSeconds_idx";
DROP INDEX IF EXISTS "MediaArtifact_videoAssetId_kind_key";
DROP INDEX IF EXISTS "MediaArtifact_kind_updatedAt_idx";

CREATE INDEX "ReviewAsset_projectId_medium_updatedAt_idx" ON "ReviewAsset"("projectId", "medium", "updatedAt");
CREATE INDEX "ReviewAsset_uploadedById_uploadedAt_idx" ON "ReviewAsset"("uploadedById", "uploadedAt");
CREATE INDEX "ReviewAsset_reviewerId_status_idx" ON "ReviewAsset"("reviewerId", "status");
CREATE INDEX "ReviewAsset_approvedById_approvedAt_idx" ON "ReviewAsset"("approvedById", "approvedAt");
CREATE UNIQUE INDEX "AssetArtifact_reviewAssetId_kind_key" ON "AssetArtifact"("reviewAssetId", "kind");
CREATE INDEX "AssetArtifact_kind_updatedAt_idx" ON "AssetArtifact"("kind", "updatedAt");
CREATE INDEX "ReviewComment_reviewAssetId_idx" ON "ReviewComment"("reviewAssetId");
CREATE INDEX "ReviewComment_reviewAssetId_status_createdAt_idx" ON "ReviewComment"("reviewAssetId", "status", "createdAt");
CREATE INDEX "ReviewComment_reviewAssetId_locatorType_createdAt_idx" ON "ReviewComment"("reviewAssetId", "locatorType", "createdAt");
CREATE INDEX "ReviewComment_reviewAssetId_workEntityType_workEntityId_idx" ON "ReviewComment"("reviewAssetId", "workEntityType", "workEntityId");
CREATE INDEX "ReviewComment_carriedFromAssetId_carriedFromCommentId_idx" ON "ReviewComment"("carriedFromAssetId", "carriedFromCommentId");

ALTER TABLE "ReviewAsset" ADD CONSTRAINT "ReviewAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewAsset" ADD CONSTRAINT "ReviewAsset_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewAsset" ADD CONSTRAINT "ReviewAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewAsset" ADD CONSTRAINT "ReviewAsset_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewAsset" ADD CONSTRAINT "ReviewAsset_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewAsset" ADD CONSTRAINT "ReviewAsset_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- Canonical identifier migration for string-backed references. Cluster has no active
-- pre-1.0 deployments, so Block 29A intentionally moves the source of truth rather
-- than preserving parallel aliases.
UPDATE "AccessRule" SET "targetKind" = 'review_asset' WHERE "targetKind" = 'video';
UPDATE "ProjectControlRecord" SET "linkedEntityType" = 'review_asset' WHERE "linkedEntityType" = 'video';
UPDATE "ProjectRelationship" SET "sourceType" = 'review_asset' WHERE "sourceType" = 'video';
UPDATE "ProjectRelationship" SET "targetType" = 'review_asset' WHERE "targetType" = 'video';
UPDATE "ProjectRelationship" SET "sourceType" = 'review_comment' WHERE "sourceType" IN ('video_comment', 'video-comment');
UPDATE "ProjectRelationship" SET "targetType" = 'review_comment' WHERE "targetType" IN ('video_comment', 'video-comment');
UPDATE "ActivityEvent" SET "entityType" = 'review_asset' WHERE "entityType" IN ('video', 'video_asset');
UPDATE "ActivityEvent" SET "entityType" = 'review_comment' WHERE "entityType" IN ('video_comment', 'video-comment');
UPDATE "ActivityEvent" SET "entityType" = 'review_version' WHERE "entityType" = 'video_version';
UPDATE "ActivityEvent" SET "entityType" = 'review_asset_processing' WHERE "entityType" = 'video_media_processing';
UPDATE "NotificationInboxItem" SET "entityType" = 'review_asset' WHERE "entityType" IN ('video', 'video_asset');
UPDATE "NotificationInboxItem" SET "entityType" = 'review_comment' WHERE "entityType" IN ('video_comment', 'video-comment');
UPDATE "NotificationInboxItem" SET "entityType" = 'review_version' WHERE "entityType" = 'video_version';
UPDATE "NotificationInboxItem" SET "tool" = 'review' WHERE "tool" = 'video_review';
UPDATE "CopyrightCase" SET "resourceType" = 'review_asset' WHERE "resourceType" = 'video_asset';
UPDATE "CopyrightResourceRestriction" SET "resourceType" = 'review_asset' WHERE "resourceType" = 'video_asset';
UPDATE "ClusterPersistenceRecord" SET "entityType" = 'review_asset' WHERE "entityType" IN ('video', 'video_asset');
UPDATE "SyncTombstone" SET "entityType" = 'review_asset' WHERE "entityType" IN ('video', 'video_asset');
UPDATE "ClusterSyncConflict" SET "entityType" = 'review_asset' WHERE "entityType" IN ('video', 'video_asset');

-- User preference/tool blobs are JSON encoded TEXT. Migrate only valid canonical
-- keys/values that Block 29A owns; project type id "video" remains a valid concept.
UPDATE "User"
SET "toolPermissions" = (("toolPermissions"::jsonb - 'video') || jsonb_build_object('viewer', "toolPermissions"::jsonb -> 'video'))::text
WHERE "toolPermissions"::jsonb ? 'video' AND NOT ("toolPermissions"::jsonb ? 'viewer');
UPDATE "User"
SET "preferences" = replace("preferences", '"video_review"', '"review"')
WHERE "preferences" LIKE '%"video_review"%';

ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
