ALTER TABLE "User"
  ADD COLUMN "authenticationGeneration" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "verificationGeneration" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Session"
  ADD COLUMN "authenticationGeneration" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SecurityVerificationGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "verifierStrength" TEXT NOT NULL DEFAULT 'knowledge',
  "verificationGeneration" INTEGER NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "singleUse" BOOLEAN NOT NULL DEFAULT false,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "requiredReason" TEXT,
  "auditCorrelationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityVerificationGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityVerificationGrant_sessionId_purpose_key" ON "SecurityVerificationGrant"("sessionId", "purpose");
CREATE INDEX "SecurityVerificationGrant_userId_revokedAt_expiresAt_idx" ON "SecurityVerificationGrant"("userId", "revokedAt", "expiresAt");
CREATE INDEX "SecurityVerificationGrant_sessionId_revokedAt_expiresAt_idx" ON "SecurityVerificationGrant"("sessionId", "revokedAt", "expiresAt");

ALTER TABLE "SecurityVerificationGrant" ADD CONSTRAINT "SecurityVerificationGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityVerificationGrant" ADD CONSTRAINT "SecurityVerificationGrant_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
