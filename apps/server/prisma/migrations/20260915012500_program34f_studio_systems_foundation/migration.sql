CREATE TABLE "PacketDefinition" (
  "id" TEXT NOT NULL,
  "libraryFolderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'knowledge',
  "versionLabel" TEXT NOT NULL DEFAULT '1.0',
  "audienceJson" TEXT NOT NULL DEFAULT '{"mode":"all","targets":[]}',
  "completionMode" TEXT NOT NULL DEFAULT 'none',
  "completionFormId" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "dueDays" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PacketDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PacketDefinition_libraryFolderId_key" ON "PacketDefinition"("libraryFolderId");
CREATE INDEX "PacketDefinition_kind_required_idx" ON "PacketDefinition"("kind", "required");
CREATE INDEX "PacketDefinition_completionFormId_idx" ON "PacketDefinition"("completionFormId");
ALTER TABLE "PacketDefinition" ADD CONSTRAINT "PacketDefinition_libraryFolderId_fkey" FOREIGN KEY ("libraryFolderId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudioForm" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "purpose" TEXT NOT NULL DEFAULT 'general',
  "audienceJson" TEXT NOT NULL DEFAULT '{"mode":"all","targets":[]}',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioForm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioForm_key_key" ON "StudioForm"("key");
CREATE INDEX "StudioForm_purpose_status_idx" ON "StudioForm"("purpose", "status");
CREATE INDEX "StudioForm_updatedAt_idx" ON "StudioForm"("updatedAt");

CREATE TABLE "StudioFormVersion" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "schemaJson" TEXT NOT NULL,
  "settingsJson" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioFormVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioFormVersion_formId_version_key" ON "StudioFormVersion"("formId", "version");
CREATE INDEX "StudioFormVersion_formId_status_version_idx" ON "StudioFormVersion"("formId", "status", "version");
ALTER TABLE "StudioFormVersion" ADD CONSTRAINT "StudioFormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StudioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudioFormSubmission" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "formVersionId" TEXT NOT NULL,
  "userId" TEXT,
  "respondentName" TEXT,
  "respondentEmail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "answersJson" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioFormSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudioFormSubmission_formId_status_submittedAt_idx" ON "StudioFormSubmission"("formId", "status", "submittedAt");
CREATE INDEX "StudioFormSubmission_userId_submittedAt_idx" ON "StudioFormSubmission"("userId", "submittedAt");
CREATE INDEX "StudioFormSubmission_respondentEmail_submittedAt_idx" ON "StudioFormSubmission"("respondentEmail", "submittedAt");
ALTER TABLE "StudioFormSubmission" ADD CONSTRAINT "StudioFormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StudioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormSubmission" ADD CONSTRAINT "StudioFormSubmission_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "StudioFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioFormSubmission" ADD CONSTRAINT "StudioFormSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StudioPolicy" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "audienceJson" TEXT NOT NULL DEFAULT '{"mode":"all","targets":[]}',
  "requiredForAccess" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioPolicy_key_key" ON "StudioPolicy"("key");
CREATE INDEX "StudioPolicy_status_requiredForAccess_idx" ON "StudioPolicy"("status", "requiredForAccess");

CREATE TABLE "StudioPolicyVersion" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "versionLabel" TEXT NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "acceptanceMode" TEXT NOT NULL DEFAULT 'acknowledge',
  "formVersionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "effectiveAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioPolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioPolicyVersion_policyId_version_key" ON "StudioPolicyVersion"("policyId", "version");
CREATE UNIQUE INDEX "StudioPolicyVersion_policyId_versionLabel_key" ON "StudioPolicyVersion"("policyId", "versionLabel");
CREATE INDEX "StudioPolicyVersion_policyId_status_publishedAt_idx" ON "StudioPolicyVersion"("policyId", "status", "publishedAt");
CREATE INDEX "StudioPolicyVersion_contentHash_idx" ON "StudioPolicyVersion"("contentHash");
CREATE INDEX "StudioPolicyVersion_formVersionId_idx" ON "StudioPolicyVersion"("formVersionId");
ALTER TABLE "StudioPolicyVersion" ADD CONSTRAINT "StudioPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "StudioPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudioPolicyAcceptance" (
  "id" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "acceptanceMode" TEXT NOT NULL,
  "initials" TEXT,
  "signature" TEXT,
  "formSubmissionId" TEXT,
  "policyContentHash" TEXT NOT NULL,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioPolicyAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioPolicyAcceptance_policyVersionId_userId_key" ON "StudioPolicyAcceptance"("policyVersionId", "userId");
CREATE INDEX "StudioPolicyAcceptance_userId_acceptedAt_idx" ON "StudioPolicyAcceptance"("userId", "acceptedAt");
CREATE INDEX "StudioPolicyAcceptance_policyVersionId_acceptedAt_idx" ON "StudioPolicyAcceptance"("policyVersionId", "acceptedAt");
ALTER TABLE "StudioPolicyAcceptance" ADD CONSTRAINT "StudioPolicyAcceptance_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "StudioPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioPolicyAcceptance" ADD CONSTRAINT "StudioPolicyAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PacketCompletion" (
  "id" TEXT NOT NULL,
  "packetDefinitionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "formSubmissionId" TEXT,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PacketCompletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PacketCompletion_packetDefinitionId_userId_key" ON "PacketCompletion"("packetDefinitionId", "userId");
CREATE INDEX "PacketCompletion_userId_completedAt_idx" ON "PacketCompletion"("userId", "completedAt");
CREATE INDEX "PacketCompletion_packetDefinitionId_completedAt_idx" ON "PacketCompletion"("packetDefinitionId", "completedAt");
CREATE INDEX "PacketCompletion_formSubmissionId_idx" ON "PacketCompletion"("formSubmissionId");
ALTER TABLE "PacketCompletion" ADD CONSTRAINT "PacketCompletion_packetDefinitionId_fkey" FOREIGN KEY ("packetDefinitionId") REFERENCES "PacketDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PacketCompletion" ADD CONSTRAINT "PacketCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PacketCompletion" ADD CONSTRAINT "PacketCompletion_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "StudioFormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

