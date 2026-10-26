-- Idempotent, per-deadline credential lifecycle notices. Secret values and
-- Vault record identifiers never appear in the recipient inbox projection.
CREATE TABLE "StudioInventoryExpiryNotice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subjectKind" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "stage" TEXT NOT NULL,
  "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StudioInventoryExpiryNotice_subjectKind_subjectId_expiresAt_stage_key"
  ON "StudioInventoryExpiryNotice" ("subjectKind", "subjectId", "expiresAt", "stage");
CREATE INDEX "StudioInventoryExpiryNotice_stage_notifiedAt_idx"
  ON "StudioInventoryExpiryNotice" ("stage", "notifiedAt");
CREATE INDEX "StudioInventoryExpiryNotice_subjectKind_subjectId_idx"
  ON "StudioInventoryExpiryNotice" ("subjectKind", "subjectId");
