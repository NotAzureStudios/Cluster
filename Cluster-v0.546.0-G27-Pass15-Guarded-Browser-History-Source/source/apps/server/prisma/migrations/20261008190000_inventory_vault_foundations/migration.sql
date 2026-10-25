CREATE TABLE "StudioInventoryAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'physical',
  "provider" TEXT,
  "reference" TEXT,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StudioInventoryAsset_kind_status_title_idx" ON "StudioInventoryAsset"("kind", "status", "title");
ALTER TABLE "StudioInventoryAsset" ADD CONSTRAINT "StudioInventoryAsset_capacity_positive" CHECK ("capacity" > 0);

CREATE TABLE "StudioInventoryAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "assignedById" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "StudioInventoryAllocation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StudioInventoryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "StudioInventoryAllocation_assetId_status_idx" ON "StudioInventoryAllocation"("assetId", "status");
CREATE INDEX "StudioInventoryAllocation_userId_status_idx" ON "StudioInventoryAllocation"("userId", "status");
ALTER TABLE "StudioInventoryAllocation" ADD CONSTRAINT "StudioInventoryAllocation_quantity_positive" CHECK ("quantity" > 0);
CREATE UNIQUE INDEX "StudioInventoryAllocation_active_unique" ON "StudioInventoryAllocation" ("assetId", "userId") WHERE "status" = 'active';

CREATE TABLE "StudioVaultSecret" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdById" TEXT,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StudioVaultSecret_kind_revokedAt_idx" ON "StudioVaultSecret"("kind", "revokedAt");
CREATE INDEX "StudioVaultSecret_expiresAt_idx" ON "StudioVaultSecret"("expiresAt");

CREATE TABLE "PacketRelease" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "packetDefinitionId" TEXT NOT NULL,
  "versionLabel" TEXT NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PacketRelease_packetDefinitionId_fkey" FOREIGN KEY ("packetDefinitionId") REFERENCES "PacketDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PacketRelease_packetDefinitionId_versionLabel_key" ON "PacketRelease"("packetDefinitionId", "versionLabel");
CREATE INDEX "PacketRelease_packetDefinitionId_publishedAt_idx" ON "PacketRelease"("packetDefinitionId", "publishedAt");
