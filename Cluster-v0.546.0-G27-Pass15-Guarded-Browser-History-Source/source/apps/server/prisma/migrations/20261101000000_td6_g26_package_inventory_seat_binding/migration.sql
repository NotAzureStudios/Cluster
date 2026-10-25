-- A Package entitlement is necessary but insufficient when its administrator
-- explicitly requires independently reviewed Inventory seat custody.
-- No secret material or Vault data is copied into Package records.
CREATE TABLE "ManagedPackageSeatRequirement" (
  "packageId" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reason" TEXT NOT NULL,
  "configuredById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedPackageSeatRequirement_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ManagedPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagedPackageSeatRequirement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StudioInventoryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ManagedPackageSeatRequirement_assetId_idx" ON "ManagedPackageSeatRequirement"("assetId");
