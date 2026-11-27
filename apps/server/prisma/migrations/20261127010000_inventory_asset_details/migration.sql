ALTER TABLE "StudioInventoryAsset" ADD COLUMN "location" TEXT, ADD COLUMN "url" TEXT, ADD COLUMN "cost" TEXT, ADD COLUMN "purchasedOn" TIMESTAMP(3), ADD COLUMN "renewsOn" TIMESTAMP(3), ADD COLUMN "notes" TEXT;
CREATE INDEX "StudioInventoryAsset_renewsOn_idx" ON "StudioInventoryAsset"("renewsOn");
