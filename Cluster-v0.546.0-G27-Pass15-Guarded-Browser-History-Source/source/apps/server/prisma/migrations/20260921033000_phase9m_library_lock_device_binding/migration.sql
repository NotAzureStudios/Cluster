ALTER TABLE "LibraryAssetLock" ADD COLUMN "ownerDeviceId" TEXT;
ALTER TABLE "LibraryAssetLock" ADD COLUMN "ownerDeviceProofFingerprint" TEXT;
CREATE INDEX "LibraryAssetLock_ownerDeviceId_state_expiresAt_idx" ON "LibraryAssetLock"("ownerDeviceId", "state", "expiresAt");
