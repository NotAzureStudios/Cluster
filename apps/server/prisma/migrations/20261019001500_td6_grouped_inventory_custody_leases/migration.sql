-- Digital seat leases and key assignment disclosure evidence. Physical custody is never time-reclaimed.
ALTER TABLE "StudioInventoryAllocation" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "StudioInventoryAllocation" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "StudioInventoryAllocation_assetId_status_expiresAt_idx" ON "StudioInventoryAllocation"("assetId", "status", "expiresAt");
ALTER TABLE "StudioInventoryKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "StudioInventoryKey" ADD COLUMN "firstRevealedAt" TIMESTAMP(3);
CREATE INDEX "StudioInventoryKey_poolId_status_expiresAt_idx" ON "StudioInventoryKey"("poolId", "status", "expiresAt");
