-- Phase 9E.2 Library transfer/derivative/collection/review/lock authority.
-- Review workflow is independent from the broader Library lifecycle/status vocabulary.
ALTER TABLE "KnowledgeItem" ADD COLUMN "reviewState" TEXT NOT NULL DEFAULT 'draft';
UPDATE "KnowledgeItem" SET "reviewState" = CASE
  WHEN "status" = 'approved' OR "lifecycleState" = 'approved' THEN 'approved'
  WHEN "status" = 'in-review' OR "lifecycleState" = 'in-review' THEN 'in-review'
  WHEN "status" = 'needs-update' THEN 'changes-requested'
  WHEN "status" = 'archived' OR "lifecycleState" = 'deprecated' THEN 'archived'
  ELSE 'draft'
END;
CREATE INDEX "KnowledgeItem_reviewState_updatedAt_idx" ON "KnowledgeItem"("reviewState", "updatedAt");

CREATE TABLE "LibraryCollection" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'manual',
  "queryJson" TEXT NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "LibraryCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryCollectionMembership" (
  "collectionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "addedById" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryCollectionMembership_pkey" PRIMARY KEY ("collectionId", "itemId")
);

CREATE TABLE "LibraryDerivative" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "variantKey" TEXT NOT NULL DEFAULT 'default',
  "sourceChecksumSha256" TEXT NOT NULL,
  "contentChecksumSha256" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "mimeType" TEXT,
  "storagePath" TEXT,
  "sizeBytes" INTEGER,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "generatedByJobId" TEXT,
  "builtAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryDerivative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryAssetLock" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'active',
  "sourceKind" TEXT,
  "sourceRef" TEXT,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "releasedById" TEXT,
  "forceReleased" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryAssetLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryWatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryWatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryCollection_ownerId_archived_updatedAt_idx" ON "LibraryCollection"("ownerId", "archived", "updatedAt");
CREATE INDEX "LibraryCollection_projectId_archived_updatedAt_idx" ON "LibraryCollection"("projectId", "archived", "updatedAt");
CREATE INDEX "LibraryCollection_kind_archived_updatedAt_idx" ON "LibraryCollection"("kind", "archived", "updatedAt");
CREATE INDEX "LibraryCollectionMembership_itemId_addedAt_idx" ON "LibraryCollectionMembership"("itemId", "addedAt");
CREATE INDEX "LibraryCollectionMembership_collectionId_addedAt_idx" ON "LibraryCollectionMembership"("collectionId", "addedAt");
CREATE UNIQUE INDEX "LibraryDerivative_itemId_kind_variantKey_sourceChecksumSha256_key" ON "LibraryDerivative"("itemId", "kind", "variantKey", "sourceChecksumSha256");
CREATE INDEX "LibraryDerivative_itemId_status_updatedAt_idx" ON "LibraryDerivative"("itemId", "status", "updatedAt");
CREATE INDEX "LibraryDerivative_sourceChecksumSha256_status_idx" ON "LibraryDerivative"("sourceChecksumSha256", "status");
CREATE INDEX "LibraryDerivative_generatedByJobId_idx" ON "LibraryDerivative"("generatedByJobId");
CREATE UNIQUE INDEX "LibraryAssetLock_itemId_key" ON "LibraryAssetLock"("itemId");
CREATE INDEX "LibraryAssetLock_ownerId_state_expiresAt_idx" ON "LibraryAssetLock"("ownerId", "state", "expiresAt");
CREATE INDEX "LibraryAssetLock_state_expiresAt_idx" ON "LibraryAssetLock"("state", "expiresAt");
CREATE INDEX "LibraryAssetLock_sourceKind_sourceRef_idx" ON "LibraryAssetLock"("sourceKind", "sourceRef");
CREATE UNIQUE INDEX "LibraryWatch_userId_itemId_key" ON "LibraryWatch"("userId", "itemId");
CREATE INDEX "LibraryWatch_userId_createdAt_idx" ON "LibraryWatch"("userId", "createdAt");
CREATE INDEX "LibraryWatch_itemId_createdAt_idx" ON "LibraryWatch"("itemId", "createdAt");

ALTER TABLE "LibraryCollectionMembership" ADD CONSTRAINT "LibraryCollectionMembership_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "LibraryCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryCollectionMembership" ADD CONSTRAINT "LibraryCollectionMembership_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryDerivative" ADD CONSTRAINT "LibraryDerivative_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryAssetLock" ADD CONSTRAINT "LibraryAssetLock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryWatch" ADD CONSTRAINT "LibraryWatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
