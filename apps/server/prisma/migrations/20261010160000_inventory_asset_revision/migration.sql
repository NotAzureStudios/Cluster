ALTER TABLE "StudioInventoryAsset" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StudioInventoryAllocation" ADD COLUMN "closedReason" TEXT;
ALTER TABLE "StudioInventoryAllocation" ADD COLUMN "closedById" TEXT;
