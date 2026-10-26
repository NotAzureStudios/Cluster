-- Phase 9E Library 2.0 canonical object identity/governance foundation.
ALTER TABLE "KnowledgeItem"
  ADD COLUMN "creatorId" TEXT,
  ADD COLUMN "uploaderId" TEXT,
  ADD COLUMN "lastEditorId" TEXT,
  ADD COLUMN "generatedForUserId" TEXT,
  ADD COLUMN "lifecycleState" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "classification" TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN "retentionPolicyKey" TEXT,
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "integrityState" TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN "integrityCheckedAt" TIMESTAMP(3),
  ADD COLUMN "originKind" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "originRef" TEXT,
  ADD COLUMN "generatedByKind" TEXT,
  ADD COLUMN "generatedById" TEXT;

UPDATE "KnowledgeItem"
SET
  "creatorId" = COALESCE("ownerId", "creatorId"),
  "lastEditorId" = COALESCE("ownerId", "lastEditorId"),
  "uploaderId" = CASE WHEN "source" = 'upload' THEN COALESCE("ownerId", "uploaderId") ELSE "uploaderId" END,
  "originKind" = CASE WHEN "source" IS NULL OR "source" = '' THEN 'manual' ELSE "source" END,
  "integrityState" = CASE WHEN "checksumSha256" IS NOT NULL THEN 'verified' ELSE 'unverified' END,
  "integrityCheckedAt" = CASE WHEN "checksumSha256" IS NOT NULL THEN "updatedAt" ELSE NULL END;

CREATE TABLE "LibraryVersion" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "actorId" TEXT,
  "note" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "status" TEXT NOT NULL,
  "lifecycleState" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "fileName" TEXT,
  "originalName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "checksumSha256" TEXT,
  "extension" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryBacklink" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "sourceResourceKind" TEXT NOT NULL,
  "sourceResourceId" TEXT NOT NULL,
  "relationKind" TEXT NOT NULL DEFAULT 'uses',
  "label" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryBacklink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryFavorite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryVersion_itemId_versionNumber_key" ON "LibraryVersion"("itemId", "versionNumber");
CREATE INDEX "LibraryVersion_itemId_createdAt_idx" ON "LibraryVersion"("itemId", "createdAt");
CREATE INDEX "LibraryVersion_actorId_createdAt_idx" ON "LibraryVersion"("actorId", "createdAt");
CREATE INDEX "LibraryVersion_checksumSha256_idx" ON "LibraryVersion"("checksumSha256");
CREATE UNIQUE INDEX "LibraryBacklink_itemId_sourceResourceKind_sourceResourceId_relationKind_key" ON "LibraryBacklink"("itemId", "sourceResourceKind", "sourceResourceId", "relationKind");
CREATE INDEX "LibraryBacklink_sourceResourceKind_sourceResourceId_idx" ON "LibraryBacklink"("sourceResourceKind", "sourceResourceId");
CREATE INDEX "LibraryBacklink_itemId_relationKind_idx" ON "LibraryBacklink"("itemId", "relationKind");
CREATE UNIQUE INDEX "LibraryFavorite_userId_itemId_key" ON "LibraryFavorite"("userId", "itemId");
CREATE INDEX "LibraryFavorite_userId_createdAt_idx" ON "LibraryFavorite"("userId", "createdAt");
CREATE INDEX "LibraryFavorite_itemId_createdAt_idx" ON "LibraryFavorite"("itemId", "createdAt");

CREATE INDEX "KnowledgeItem_creatorId_idx" ON "KnowledgeItem"("creatorId");
CREATE INDEX "KnowledgeItem_uploaderId_idx" ON "KnowledgeItem"("uploaderId");
CREATE INDEX "KnowledgeItem_lastEditorId_idx" ON "KnowledgeItem"("lastEditorId");
CREATE INDEX "KnowledgeItem_generatedForUserId_idx" ON "KnowledgeItem"("generatedForUserId");
CREATE INDEX "KnowledgeItem_lifecycleState_updatedAt_idx" ON "KnowledgeItem"("lifecycleState", "updatedAt");
CREATE INDEX "KnowledgeItem_classification_idx" ON "KnowledgeItem"("classification");
CREATE INDEX "KnowledgeItem_retentionUntil_idx" ON "KnowledgeItem"("retentionUntil");
CREATE INDEX "KnowledgeItem_legalHold_retentionUntil_idx" ON "KnowledgeItem"("legalHold", "retentionUntil");
CREATE INDEX "KnowledgeItem_deletedAt_idx" ON "KnowledgeItem"("deletedAt");
CREATE INDEX "KnowledgeItem_integrityState_updatedAt_idx" ON "KnowledgeItem"("integrityState", "updatedAt");
CREATE INDEX "KnowledgeItem_originKind_idx" ON "KnowledgeItem"("originKind");
CREATE INDEX "KnowledgeItem_generatedByKind_generatedById_idx" ON "KnowledgeItem"("generatedByKind", "generatedById");

ALTER TABLE "LibraryVersion" ADD CONSTRAINT "LibraryVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryBacklink" ADD CONSTRAINT "LibraryBacklink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryFavorite" ADD CONSTRAINT "LibraryFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryFavorite" ADD CONSTRAINT "LibraryFavorite_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
