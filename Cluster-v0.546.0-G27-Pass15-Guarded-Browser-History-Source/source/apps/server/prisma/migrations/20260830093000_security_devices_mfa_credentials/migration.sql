ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
CREATE INDEX IF NOT EXISTS "Session_userId_deviceId_revokedAt_expiresAt_idx"
  ON "Session"("userId", "deviceId", "revokedAt", "expiresAt");

CREATE TABLE IF NOT EXISTS "DeviceRegistration" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "label" TEXT,
  "platform" TEXT,
  "userAgent" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceRegistration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceRegistration_userId_deviceId_key" ON "DeviceRegistration"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "DeviceRegistration_userId_revokedAt_lastSeenAt_idx" ON "DeviceRegistration"("userId", "revokedAt", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "DeviceRegistration_deviceId_lastSeenAt_idx" ON "DeviceRegistration"("deviceId", "lastSeenAt");

CREATE TABLE IF NOT EXISTS "UserMfaCredential" (
  "userId" TEXT NOT NULL,
  "encryptedSecret" TEXT NOT NULL,
  "enabledAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMfaCredential_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMfaRecoveryCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserMfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserMfaRecoveryCode_codeHash_key" ON "UserMfaRecoveryCode"("codeHash");
CREATE INDEX IF NOT EXISTS "UserMfaRecoveryCode_userId_consumedAt_createdAt_idx" ON "UserMfaRecoveryCode"("userId", "consumedAt", "createdAt");

CREATE TABLE IF NOT EXISTS "MfaLoginChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "deviceId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaLoginChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MfaLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MfaLoginChallenge_challengeHash_key" ON "MfaLoginChallenge"("challengeHash");
CREATE INDEX IF NOT EXISTS "MfaLoginChallenge_userId_consumedAt_expiresAt_idx" ON "MfaLoginChallenge"("userId", "consumedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "MfaLoginChallenge_expiresAt_consumedAt_idx" ON "MfaLoginChallenge"("expiresAt", "consumedAt");

CREATE TABLE IF NOT EXISTS "ServiceCredential" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "credentialType" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT '[]',
  "tokenHash" TEXT,
  "tokenPrefix" TEXT,
  "encryptedSecret" TEXT,
  "createdById" TEXT,
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceCredential_tokenHash_key" ON "ServiceCredential"("tokenHash");
CREATE INDEX IF NOT EXISTS "ServiceCredential_credentialType_revokedAt_expiresAt_idx" ON "ServiceCredential"("credentialType", "revokedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "ServiceCredential_createdById_revokedAt_createdAt_idx" ON "ServiceCredential"("createdById", "revokedAt", "createdAt");
