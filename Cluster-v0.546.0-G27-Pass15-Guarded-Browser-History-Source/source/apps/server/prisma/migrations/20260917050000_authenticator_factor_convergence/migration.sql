CREATE TABLE "Authenticator" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "strength" TEXT NOT NULL DEFAULT 'mfa',
  "encryptedSecret" TEXT,
  "credentialId" TEXT,
  "publicKeySpki" TEXT,
  "publicKeyAlgorithm" TEXT,
  "signCount" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT NOT NULL DEFAULT '[]',
  "aaguid" TEXT,
  "attachment" TEXT,
  "discoverable" BOOLEAN NOT NULL DEFAULT false,
  "backupEligible" BOOLEAN NOT NULL DEFAULT false,
  "backupState" BOOLEAN NOT NULL DEFAULT false,
  "userVerification" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "enrolledAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "compromisedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Authenticator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthenticatorRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthenticatorRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthenticatorChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "authenticatorId" TEXT,
  "flow" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "deviceId" TEXT,
  "rpId" TEXT,
  "expectedOrigin" TEXT,
  "context" TEXT NOT NULL DEFAULT '{}',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthenticatorChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Authenticator_credentialId_key" ON "Authenticator"("credentialId");
CREATE INDEX "Authenticator_userId_state_kind_idx" ON "Authenticator"("userId", "state", "kind");
CREATE INDEX "Authenticator_userId_revokedAt_lastUsedAt_idx" ON "Authenticator"("userId", "revokedAt", "lastUsedAt");
CREATE INDEX "Authenticator_credentialId_state_idx" ON "Authenticator"("credentialId", "state");
CREATE UNIQUE INDEX "AuthenticatorRecoveryCode_codeHash_key" ON "AuthenticatorRecoveryCode"("codeHash");
CREATE INDEX "AuthenticatorRecoveryCode_userId_consumedAt_createdAt_idx" ON "AuthenticatorRecoveryCode"("userId", "consumedAt", "createdAt");
CREATE UNIQUE INDEX "AuthenticatorChallenge_challengeHash_key" ON "AuthenticatorChallenge"("challengeHash");
CREATE INDEX "AuthenticatorChallenge_userId_flow_consumedAt_expiresAt_idx" ON "AuthenticatorChallenge"("userId", "flow", "consumedAt", "expiresAt");
CREATE INDEX "AuthenticatorChallenge_authenticatorId_consumedAt_expiresAt_idx" ON "AuthenticatorChallenge"("authenticatorId", "consumedAt", "expiresAt");
CREATE INDEX "AuthenticatorChallenge_expiresAt_consumedAt_idx" ON "AuthenticatorChallenge"("expiresAt", "consumedAt");

ALTER TABLE "Authenticator" ADD CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthenticatorRecoveryCode" ADD CONSTRAINT "AuthenticatorRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthenticatorChallenge" ADD CONSTRAINT "AuthenticatorChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthenticatorChallenge" ADD CONSTRAINT "AuthenticatorChallenge_authenticatorId_fkey" FOREIGN KEY ("authenticatorId") REFERENCES "Authenticator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing TOTP enrollments and recovery codes while moving them under the
-- canonical factor authority. Existing TOTP secrets keep the same encryption purpose.
INSERT INTO "Authenticator" (
  "id", "userId", "kind", "label", "state", "strength", "encryptedSecret", "enrolledAt", "lastUsedAt", "createdAt", "updatedAt"
)
SELECT
  'totp_' || md5("userId"), "userId", 'totp', 'Authenticator app',
  CASE WHEN "enabledAt" IS NULL THEN 'pending' ELSE 'active' END,
  'mfa', "encryptedSecret", "enabledAt", "lastUsedAt", "createdAt", "updatedAt"
FROM "UserMfaCredential";

INSERT INTO "AuthenticatorRecoveryCode" ("id", "userId", "codeHash", "consumedAt", "createdAt")
SELECT "id", "userId", "codeHash", "consumedAt", "createdAt" FROM "UserMfaRecoveryCode";

INSERT INTO "AuthenticatorChallenge" (
  "id", "userId", "flow", "kind", "challengeHash", "deviceId", "expiresAt", "consumedAt", "createdAt"
)
SELECT "id", "userId", 'login', 'any', "challengeHash", "deviceId", "expiresAt", "consumedAt", "createdAt" FROM "MfaLoginChallenge";

DROP TABLE "MfaLoginChallenge";
DROP TABLE "UserMfaRecoveryCode";
DROP TABLE "UserMfaCredential";
