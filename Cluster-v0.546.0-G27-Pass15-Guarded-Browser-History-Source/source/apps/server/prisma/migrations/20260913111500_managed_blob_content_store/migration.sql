CREATE TABLE "ManagedBlob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "mimeType" TEXT,
  "storageProvider" TEXT NOT NULL,
  "storageTier" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "referenceCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedBlob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProjectFile" ADD COLUMN "managedBlobId" TEXT;

CREATE UNIQUE INDEX "ManagedBlob_workspaceId_checksumSha256_key"
  ON "ManagedBlob"("workspaceId","checksumSha256");
CREATE INDEX "ManagedBlob_workspaceId_referenceCount_updatedAt_idx"
  ON "ManagedBlob"("workspaceId","referenceCount","updatedAt");
CREATE INDEX "ManagedBlob_referenceCount_updatedAt_idx"
  ON "ManagedBlob"("referenceCount","updatedAt");
CREATE INDEX "ProjectFile_managedBlobId_idx"
  ON "ProjectFile"("managedBlobId");

ALTER TABLE "ProjectFile"
  ADD CONSTRAINT "ProjectFile_managedBlobId_fkey"
  FOREIGN KEY ("managedBlobId") REFERENCES "ManagedBlob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "cluster_managed_blob_refcount"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."managedBlobId" IS NOT NULL THEN
      UPDATE "ManagedBlob"
      SET "referenceCount" = "referenceCount" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = NEW."managedBlobId";
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD."managedBlobId" IS NOT NULL THEN
      UPDATE "ManagedBlob"
      SET "referenceCount" = GREATEST(0, "referenceCount" - 1), "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = OLD."managedBlobId";
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."managedBlobId" IS DISTINCT FROM NEW."managedBlobId" THEN
      IF OLD."managedBlobId" IS NOT NULL THEN
        UPDATE "ManagedBlob"
        SET "referenceCount" = GREATEST(0, "referenceCount" - 1), "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = OLD."managedBlobId";
      END IF;
      IF NEW."managedBlobId" IS NOT NULL THEN
        UPDATE "ManagedBlob"
        SET "referenceCount" = "referenceCount" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = NEW."managedBlobId";
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectFile_managedBlob_refcount_insert"
AFTER INSERT ON "ProjectFile"
FOR EACH ROW EXECUTE FUNCTION "cluster_managed_blob_refcount"();

CREATE TRIGGER "ProjectFile_managedBlob_refcount_update"
AFTER UPDATE OF "managedBlobId" ON "ProjectFile"
FOR EACH ROW EXECUTE FUNCTION "cluster_managed_blob_refcount"();

CREATE TRIGGER "ProjectFile_managedBlob_refcount_delete"
AFTER DELETE ON "ProjectFile"
FOR EACH ROW EXECUTE FUNCTION "cluster_managed_blob_refcount"();
