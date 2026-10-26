-- Cluster v0.349.0 authentication and session hardening.
ALTER TABLE "User" ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN "revocationReason" TEXT;
