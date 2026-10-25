CREATE TABLE "PersonnelRecordTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "fieldsJson" TEXT NOT NULL DEFAULT '[]',
  "requiredAttachmentsJson" TEXT NOT NULL DEFAULT '[]',
  "classification" TEXT NOT NULL DEFAULT 'confidential',
  "disclosurePolicy" TEXT NOT NULL DEFAULT 'subject_visible',
  "retentionDays" INTEGER,
  "actionType" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "PersonnelRecordTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelRecordTemplate_key_key" ON "PersonnelRecordTemplate"("key");
CREATE INDEX "PersonnelRecordTemplate_active_name_idx" ON "PersonnelRecordTemplate"("active", "name");
CREATE INDEX "PersonnelRecordTemplate_classification_active_idx" ON "PersonnelRecordTemplate"("classification", "active");
ALTER TABLE "PersonnelRecordTemplate" ADD CONSTRAINT "PersonnelRecordTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PersonnelRecord" (
  "id" TEXT NOT NULL,
  "templateId" TEXT,
  "subjectUserId" TEXT NOT NULL,
  "custodianUserId" TEXT,
  "createdById" TEXT,
  "lastModifiedById" TEXT,
  "title" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "classification" TEXT NOT NULL DEFAULT 'confidential',
  "disclosurePolicy" TEXT NOT NULL DEFAULT 'subject_visible',
  "fieldsJson" TEXT NOT NULL DEFAULT '{}',
  "effectiveAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "retentionUntil" TIMESTAMP(3),
  "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "destructionEligibleAt" TIMESTAMP(3),
  "destroyedAt" TIMESTAMP(3),
  "destroyedById" TEXT,
  "destructionReason" TEXT,
  "accessReasonRequired" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonnelRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonnelRecord_subjectUserId_status_updatedAt_idx" ON "PersonnelRecord"("subjectUserId", "status", "updatedAt");
CREATE INDEX "PersonnelRecord_custodianUserId_status_updatedAt_idx" ON "PersonnelRecord"("custodianUserId", "status", "updatedAt");
CREATE INDEX "PersonnelRecord_templateId_status_updatedAt_idx" ON "PersonnelRecord"("templateId", "status", "updatedAt");
CREATE INDEX "PersonnelRecord_classification_status_updatedAt_idx" ON "PersonnelRecord"("classification", "status", "updatedAt");
CREATE INDEX "PersonnelRecord_retentionUntil_legalHold_idx" ON "PersonnelRecord"("retentionUntil", "legalHold");
CREATE INDEX "PersonnelRecord_destroyedAt_idx" ON "PersonnelRecord"("destroyedAt");
ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PersonnelRecordTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_custodianUserId_fkey" FOREIGN KEY ("custodianUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PersonnelRecordAttachment" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "libraryItemId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'evidence',
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelRecordAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelRecordAttachment_recordId_libraryItemId_key" ON "PersonnelRecordAttachment"("recordId", "libraryItemId");
CREATE INDEX "PersonnelRecordAttachment_libraryItemId_createdAt_idx" ON "PersonnelRecordAttachment"("libraryItemId", "createdAt");
CREATE INDEX "PersonnelRecordAttachment_recordId_role_createdAt_idx" ON "PersonnelRecordAttachment"("recordId", "role", "createdAt");
ALTER TABLE "PersonnelRecordAttachment" ADD CONSTRAINT "PersonnelRecordAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PersonnelRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecordAttachment" ADD CONSTRAINT "PersonnelRecordAttachment_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "KnowledgeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecordAttachment" ADD CONSTRAINT "PersonnelRecordAttachment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PersonnelRecordAmendment" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "reason" TEXT NOT NULL,
  "previousJson" TEXT NOT NULL,
  "nextJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelRecordAmendment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonnelRecordAmendment_recordId_createdAt_idx" ON "PersonnelRecordAmendment"("recordId", "createdAt");
CREATE INDEX "PersonnelRecordAmendment_actorUserId_createdAt_idx" ON "PersonnelRecordAmendment"("actorUserId", "createdAt");
ALTER TABLE "PersonnelRecordAmendment" ADD CONSTRAINT "PersonnelRecordAmendment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PersonnelRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecordAmendment" ADD CONSTRAINT "PersonnelRecordAmendment_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PersonnelRecordAction" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonnelRecordAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonnelRecordAction_recordId_userId_actionType_key" ON "PersonnelRecordAction"("recordId", "userId", "actionType");
CREATE INDEX "PersonnelRecordAction_userId_status_dueAt_idx" ON "PersonnelRecordAction"("userId", "status", "dueAt");
CREATE INDEX "PersonnelRecordAction_recordId_status_dueAt_idx" ON "PersonnelRecordAction"("recordId", "status", "dueAt");
ALTER TABLE "PersonnelRecordAction" ADD CONSTRAINT "PersonnelRecordAction_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PersonnelRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecordAction" ADD CONSTRAINT "PersonnelRecordAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonnelRecordAccessEvent" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "allowed" BOOLEAN NOT NULL DEFAULT true,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelRecordAccessEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonnelRecordAccessEvent_recordId_createdAt_idx" ON "PersonnelRecordAccessEvent"("recordId", "createdAt");
CREATE INDEX "PersonnelRecordAccessEvent_actorUserId_createdAt_idx" ON "PersonnelRecordAccessEvent"("actorUserId", "createdAt");
CREATE INDEX "PersonnelRecordAccessEvent_action_createdAt_idx" ON "PersonnelRecordAccessEvent"("action", "createdAt");
ALTER TABLE "PersonnelRecordAccessEvent" ADD CONSTRAINT "PersonnelRecordAccessEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PersonnelRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonnelRecordAccessEvent" ADD CONSTRAINT "PersonnelRecordAccessEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
