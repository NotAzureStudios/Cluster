ALTER TABLE "PrivacyDataRequest"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "fulfilledAt" TIMESTAMP(3),
  ADD COLUMN "fulfilledById" TEXT,
  ADD COLUMN "fulfillmentMode" TEXT,
  ADD COLUMN "fulfillmentDigest" TEXT;

CREATE TABLE "PrivacyLegalHold" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "authorityRef" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdById" TEXT NOT NULL,
  "releasedById" TEXT,
  "releaseNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivacyLegalHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrivacyLegalHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PrivacyLegalHold_userId_status_createdAt_idx" ON "PrivacyLegalHold"("userId", "status", "createdAt");
CREATE INDEX "PrivacyLegalHold_status_createdAt_idx" ON "PrivacyLegalHold"("status", "createdAt");

CREATE TABLE "PrivacyErasureReceipt" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'pseudonymize',
  "planHash" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL DEFAULT '{}',
  "evidenceHash" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivacyErasureReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrivacyErasureReceipt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyDataRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrivacyErasureReceipt_requestId_key" ON "PrivacyErasureReceipt"("requestId");
CREATE INDEX "PrivacyErasureReceipt_userId_createdAt_idx" ON "PrivacyErasureReceipt"("userId", "createdAt");
CREATE INDEX "PrivacyErasureReceipt_actorUserId_createdAt_idx" ON "PrivacyErasureReceipt"("actorUserId", "createdAt");
