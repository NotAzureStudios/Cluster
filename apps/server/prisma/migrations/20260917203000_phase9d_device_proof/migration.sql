ALTER TABLE "DeviceRegistration"
  ADD COLUMN "proofStatus" TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN "proofAlgorithm" TEXT,
  ADD COLUMN "proofPublicKeySpki" TEXT,
  ADD COLUMN "proofKeyFingerprint" TEXT,
  ADD COLUMN "proofVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "proofLastSeenAt" TIMESTAMP(3);

CREATE INDEX "DeviceRegistration_userId_proofStatus_revokedAt_idx"
  ON "DeviceRegistration"("userId", "proofStatus", "revokedAt");
