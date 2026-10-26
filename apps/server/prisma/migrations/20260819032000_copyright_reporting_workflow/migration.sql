CREATE TABLE "CopyrightCase" (
  "id" TEXT NOT NULL,
  "publicReference" TEXT NOT NULL,
  "publicTokenHash" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'us_dmca',
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "reporterName" TEXT NOT NULL,
  "reporterEmail" TEXT NOT NULL,
  "reporterCompany" TEXT,
  "reporterAddress" TEXT NOT NULL,
  "reporterPhone" TEXT,
  "copyrightOwnerName" TEXT NOT NULL,
  "authorizedAgent" BOOLEAN NOT NULL DEFAULT false,
  "copyrightWorkDescription" TEXT NOT NULL,
  "infringingMaterialDescription" TEXT NOT NULL,
  "infringingLocation" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "resourceUrl" TEXT,
  "uploaderUserId" TEXT,
  "reviewerUserId" TEXT,
  "signatureText" TEXT NOT NULL,
  "goodFaithAttested" BOOLEAN NOT NULL DEFAULT false,
  "accuracyAuthorityAttested" BOOLEAN NOT NULL DEFAULT false,
  "noticeHash" TEXT NOT NULL,
  "needsInfoNote" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "restoredAt" TIMESTAMP(3),
  "legalActionReceivedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CopyrightCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CopyrightCase_publicReference_key" ON "CopyrightCase"("publicReference");
CREATE UNIQUE INDEX "CopyrightCase_publicTokenHash_key" ON "CopyrightCase"("publicTokenHash");
CREATE INDEX "CopyrightCase_status_submittedAt_idx" ON "CopyrightCase"("status", "submittedAt");
CREATE INDEX "CopyrightCase_reporterEmail_submittedAt_idx" ON "CopyrightCase"("reporterEmail", "submittedAt");
CREATE INDEX "CopyrightCase_resourceType_resourceId_idx" ON "CopyrightCase"("resourceType", "resourceId");
CREATE INDEX "CopyrightCase_uploaderUserId_submittedAt_idx" ON "CopyrightCase"("uploaderUserId", "submittedAt");
CREATE INDEX "CopyrightCase_reviewerUserId_status_idx" ON "CopyrightCase"("reviewerUserId", "status");

CREATE TABLE "CopyrightCounterNotice" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "submitterUserId" TEXT,
  "submitterName" TEXT NOT NULL,
  "submitterEmail" TEXT NOT NULL,
  "submitterAddress" TEXT NOT NULL,
  "submitterPhone" TEXT,
  "signatureText" TEXT NOT NULL,
  "materialDescription" TEXT NOT NULL,
  "previousLocation" TEXT NOT NULL,
  "mistakeAttested" BOOLEAN NOT NULL DEFAULT false,
  "jurisdictionAttested" BOOLEAN NOT NULL DEFAULT false,
  "serviceAttested" BOOLEAN NOT NULL DEFAULT false,
  "contentHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "forwardedAt" TIMESTAMP(3),
  "restorationEligibleAt" TIMESTAMP(3),
  "restorationDeadlineAt" TIMESTAMP(3),
  "legalActionReceivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CopyrightCounterNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CopyrightCounterNotice_caseId_key" ON "CopyrightCounterNotice"("caseId");
CREATE INDEX "CopyrightCounterNotice_status_submittedAt_idx" ON "CopyrightCounterNotice"("status", "submittedAt");
CREATE INDEX "CopyrightCounterNotice_submitterUserId_submittedAt_idx" ON "CopyrightCounterNotice"("submitterUserId", "submittedAt");
CREATE INDEX "CopyrightCounterNotice_restorationDeadlineAt_idx" ON "CopyrightCounterNotice"("restorationDeadlineAt");
ALTER TABLE "CopyrightCounterNotice" ADD CONSTRAINT "CopyrightCounterNotice_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CopyrightCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CopyrightEvidence" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "counterNoticeId" TEXT,
  "evidenceType" TEXT NOT NULL DEFAULT 'supporting',
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopyrightEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CopyrightEvidence_caseId_createdAt_idx" ON "CopyrightEvidence"("caseId", "createdAt");
CREATE INDEX "CopyrightEvidence_counterNoticeId_createdAt_idx" ON "CopyrightEvidence"("counterNoticeId", "createdAt");
CREATE INDEX "CopyrightEvidence_sha256_idx" ON "CopyrightEvidence"("sha256");
ALTER TABLE "CopyrightEvidence" ADD CONSTRAINT "CopyrightEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CopyrightCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CopyrightEvidence" ADD CONSTRAINT "CopyrightEvidence_counterNoticeId_fkey" FOREIGN KEY ("counterNoticeId") REFERENCES "CopyrightCounterNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CopyrightCaseEvent" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'internal',
  "message" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopyrightCaseEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CopyrightCaseEvent_caseId_createdAt_idx" ON "CopyrightCaseEvent"("caseId", "createdAt");
CREATE INDEX "CopyrightCaseEvent_eventType_createdAt_idx" ON "CopyrightCaseEvent"("eventType", "createdAt");
ALTER TABLE "CopyrightCaseEvent" ADD CONSTRAINT "CopyrightCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CopyrightCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CopyrightResourceRestriction" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'disabled',
  "disabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledById" TEXT,
  "restoredAt" TIMESTAMP(3),
  "restoredById" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CopyrightResourceRestriction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CopyrightResourceRestriction_caseId_key" ON "CopyrightResourceRestriction"("caseId");
CREATE UNIQUE INDEX "CopyrightResourceRestriction_active_resource_key" ON "CopyrightResourceRestriction"("resourceType", "resourceId") WHERE "state" = 'disabled';
CREATE INDEX "CopyrightResourceRestriction_resourceType_resourceId_state_idx" ON "CopyrightResourceRestriction"("resourceType", "resourceId", "state");
CREATE INDEX "CopyrightResourceRestriction_state_updatedAt_idx" ON "CopyrightResourceRestriction"("state", "updatedAt");
ALTER TABLE "CopyrightResourceRestriction" ADD CONSTRAINT "CopyrightResourceRestriction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CopyrightCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CopyrightStrike" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "reason" TEXT,
  "createdById" TEXT,
  "rescindedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rescindedAt" TIMESTAMP(3),
  CONSTRAINT "CopyrightStrike_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CopyrightStrike_caseId_userId_key" ON "CopyrightStrike"("caseId", "userId");
CREATE INDEX "CopyrightStrike_userId_status_createdAt_idx" ON "CopyrightStrike"("userId", "status", "createdAt");
ALTER TABLE "CopyrightStrike" ADD CONSTRAINT "CopyrightStrike_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CopyrightCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
