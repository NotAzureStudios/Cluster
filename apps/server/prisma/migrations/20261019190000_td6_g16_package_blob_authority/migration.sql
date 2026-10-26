-- Signed Package artifacts may now live in Cluster managed provider storage.
-- Existing database-byte releases remain readable; no destructive migration.
ALTER TABLE "ManagedPackageRelease" ALTER COLUMN "artifact" DROP NOT NULL;
ALTER TABLE "ManagedPackageRelease" ADD COLUMN "artifactStorageProvider" TEXT;
ALTER TABLE "ManagedPackageRelease" ADD COLUMN "artifactStorageTier" TEXT;
ALTER TABLE "ManagedPackageRelease" ADD COLUMN "artifactStorageKey" TEXT;
-- Exactly one authority: legacy SQL bytes or a complete external locator.
ALTER TABLE "ManagedPackageRelease" ADD CONSTRAINT "ManagedPackageRelease_artifact_authority_chk"
  CHECK (("artifact" IS NOT NULL AND "artifactStorageProvider" IS NULL AND "artifactStorageTier" IS NULL AND "artifactStorageKey" IS NULL) OR
         ("artifact" IS NULL AND "artifactStorageProvider" IS NOT NULL AND "artifactStorageTier" IS NOT NULL AND "artifactStorageKey" IS NOT NULL));

-- Limited device-authenticated challenge rotation reuses the existing offer.
ALTER TABLE "ManagedPackageDeviceDeployment" ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0;
