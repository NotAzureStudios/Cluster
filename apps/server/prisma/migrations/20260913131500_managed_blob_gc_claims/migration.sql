ALTER TABLE "UploadSession" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "UploadSession_clientKey_key" ON "UploadSession"("clientKey");

CREATE TABLE "EfficiencyMetric" (
  "key" TEXT NOT NULL,
  "operations" BIGINT NOT NULL DEFAULT 0,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EfficiencyMetric_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "ManagedBlob"
  ADD COLUMN "gcState" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "gcClaimToken" TEXT,
  ADD COLUMN "gcClaimedAt" TIMESTAMP(3);

CREATE INDEX "ManagedBlob_referenceCount_gcState_updatedAt_idx"
  ON "ManagedBlob"("referenceCount","gcState","updatedAt");
CREATE INDEX "ManagedBlob_referenceCount_gcState_gcClaimedAt_idx"
  ON "ManagedBlob"("referenceCount","gcState","gcClaimedAt");

CREATE OR REPLACE FUNCTION "cluster_managed_blob_require_active"()
RETURNS TRIGGER AS $$
DECLARE
  active_state TEXT;
BEGIN
  IF NEW."managedBlobId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "gcState" INTO active_state
  FROM "ManagedBlob"
  WHERE "id" = NEW."managedBlobId"
  FOR UPDATE;
  IF active_state IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'ManagedBlob % is not attachable while garbage collection owns it.', NEW."managedBlobId"
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectFile_managedBlob_require_active_insert"
BEFORE INSERT ON "ProjectFile"
FOR EACH ROW EXECUTE FUNCTION "cluster_managed_blob_require_active"();

CREATE TRIGGER "ProjectFile_managedBlob_require_active_update"
BEFORE UPDATE OF "managedBlobId" ON "ProjectFile"
FOR EACH ROW
WHEN (OLD."managedBlobId" IS DISTINCT FROM NEW."managedBlobId")
EXECUTE FUNCTION "cluster_managed_blob_require_active"();
