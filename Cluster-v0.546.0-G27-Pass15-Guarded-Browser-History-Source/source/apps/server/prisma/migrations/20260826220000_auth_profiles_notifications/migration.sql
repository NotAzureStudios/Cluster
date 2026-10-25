CREATE TABLE "PasswordResetRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requesterHint" TEXT,
  "resolvedById" TEXT,
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnerRecoveryCredential" (
  "id" TEXT NOT NULL DEFAULT 'owner',
  "ownerUserId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerRecoveryCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerRecoveryCredential_ownerUserId_key" ON "OwnerRecoveryCredential"("ownerUserId");
CREATE INDEX "PasswordResetRequest_status_createdAt_idx" ON "PasswordResetRequest"("status", "createdAt");
CREATE INDEX "PasswordResetRequest_userId_status_createdAt_idx" ON "PasswordResetRequest"("userId", "status", "createdAt");
CREATE INDEX "PasswordResetRequest_resolvedById_resolvedAt_idx" ON "PasswordResetRequest"("resolvedById", "resolvedAt");

ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OwnerRecoveryCredential" ADD CONSTRAINT "OwnerRecoveryCredential_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
