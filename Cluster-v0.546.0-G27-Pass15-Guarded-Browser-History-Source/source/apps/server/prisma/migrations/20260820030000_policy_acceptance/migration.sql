ALTER TABLE "Session" ADD COLUMN "policyAcceptanceDigest" TEXT;
ALTER TABLE "LegalPolicyVersion" ADD COLUMN "acceptanceMode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "LegalPolicyVersion" ADD COLUMN "acceptanceAudience" TEXT NOT NULL DEFAULT 'all_users';

CREATE TABLE "PolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "subjectUsername" TEXT NOT NULL,
  "subjectPolicyKey" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyKind" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyContentHash" TEXT NOT NULL,
    "acceptanceMode" TEXT NOT NULL,
    "acceptanceAudience" TEXT NOT NULL,
    "requirementHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "authMethod" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "requestId" TEXT,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicyAcceptance_evidenceHash_key" ON "PolicyAcceptance"("evidenceHash");
CREATE UNIQUE INDEX "PolicyAcceptance_subjectPolicyKey_key" ON "PolicyAcceptance"("subjectPolicyKey");
CREATE INDEX "PolicyAcceptance_policyId_acceptedAt_idx" ON "PolicyAcceptance"("policyId", "acceptedAt");
CREATE INDEX "PolicyAcceptance_userId_acceptedAt_idx" ON "PolicyAcceptance"("userId", "acceptedAt");
CREATE INDEX "PolicyAcceptance_policyKind_policyVersion_idx" ON "PolicyAcceptance"("policyKind", "policyVersion");
ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "LegalPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
