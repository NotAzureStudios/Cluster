ALTER TABLE "ServiceCredential" ADD COLUMN "secretFingerprint" TEXT;

-- Existing bearer credentials already have a one-way SHA-256 token hash. Expose only
-- a short non-secret fingerprint for operator identification; webhook signing secrets
-- receive a fingerprint when next rotated because plaintext is intentionally unavailable
-- to migrations.
UPDATE "ServiceCredential"
SET "secretFingerprint" = 'sha256:' || substring("tokenHash" from 1 for 16)
WHERE "secretFingerprint" IS NULL AND "tokenHash" IS NOT NULL;

ALTER TABLE "IntegrationConnectionSecret" ADD COLUMN "fingerprint" TEXT;
