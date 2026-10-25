-- Vault controls ciphertext. Inventory controls key-pool assignment and lifecycle.
CREATE TABLE "StudioInventoryKeyPool" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "title" TEXT NOT NULL,
 "provider" TEXT,
 "kind" TEXT NOT NULL DEFAULT 'game_key',
 "status" TEXT NOT NULL DEFAULT 'active',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdById" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StudioInventoryKeyPool_status_title_idx" ON "StudioInventoryKeyPool"("status", "title");
ALTER TABLE "StudioInventoryKeyPool" ADD CONSTRAINT "StudioInventoryKeyPool_status_check" CHECK ("status" IN ('active', 'closed'));
ALTER TABLE "StudioInventoryKeyPool" ADD CONSTRAINT "StudioInventoryKeyPool_kind_check" CHECK ("kind" IN ('game_key', 'license_key'));

CREATE TABLE "StudioInventoryKey" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "poolId" TEXT NOT NULL,
 "vaultSecretId" TEXT NOT NULL,
 "fingerprint" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'available',
 "userId" TEXT,
 "assignedById" TEXT,
 "assignedAt" TIMESTAMP(3),
 "closedAt" TIMESTAMP(3),
 "closedById" TEXT,
 "closedReason" TEXT,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "StudioInventoryKey_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "StudioInventoryKeyPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "StudioInventoryKey_vaultSecretId_fkey" FOREIGN KEY ("vaultSecretId") REFERENCES "StudioVaultSecret"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudioInventoryKey_vaultSecretId_key" ON "StudioInventoryKey"("vaultSecretId");
CREATE UNIQUE INDEX "StudioInventoryKey_poolId_fingerprint_key" ON "StudioInventoryKey"("poolId", "fingerprint");
CREATE INDEX "StudioInventoryKey_poolId_status_id_idx" ON "StudioInventoryKey"("poolId", "status", "id");
CREATE INDEX "StudioInventoryKey_userId_status_idx" ON "StudioInventoryKey"("userId", "status");
ALTER TABLE "StudioInventoryKey" ADD CONSTRAINT "StudioInventoryKey_status_check" CHECK ("status" IN ('available', 'assigned', 'redeemed', 'revoked'));
