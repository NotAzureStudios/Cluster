-- Source-only G26 completion candidate: independent review metadata, no plaintext.
CREATE TABLE "StudioVaultRotationReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "secretId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL,
  "reviewReason" TEXT,
  "externalStatus" TEXT,
  "externalNote" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "StudioVaultRotationReview_secretId_status_expiresAt_idx" ON "StudioVaultRotationReview" ("secretId","status","expiresAt");
CREATE INDEX "StudioVaultRotationReview_status_requestedAt_idx" ON "StudioVaultRotationReview" ("status","requestedAt");
CREATE INDEX "StudioVaultRotationReview_requestedById_status_idx" ON "StudioVaultRotationReview" ("requestedById","status");
