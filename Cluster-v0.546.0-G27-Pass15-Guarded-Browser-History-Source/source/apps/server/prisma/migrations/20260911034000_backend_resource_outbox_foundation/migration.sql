ALTER TABLE "NotificationInboxItem"
  ADD COLUMN "resourceKind" TEXT,
  ADD COLUMN "resourceId" TEXT,
  ADD COLUMN "resourceProjectId" TEXT;

CREATE INDEX "NotificationInboxItem_resourceKind_resourceId_idx"
  ON "NotificationInboxItem"("resourceKind", "resourceId");
CREATE INDEX "NotificationInboxItem_resourceProjectId_createdAt_idx"
  ON "NotificationInboxItem"("resourceProjectId", "createdAt");

CREATE TABLE "DomainEventOutbox" (
  "id" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "type" TEXT NOT NULL,
  "actorUserId" TEXT,
  "projectId" TEXT,
  "resourceKind" TEXT,
  "resourceId" TEXT,
  "resourceProjectId" TEXT,
  "resourceRevision" TEXT,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "completedConsumers" TEXT NOT NULL DEFAULT '[]',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 12,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DomainEventOutbox_sequence_key" UNIQUE ("sequence")
);

CREATE INDEX "DomainEventOutbox_processedAt_deadLetteredAt_availableAt_idx"
  ON "DomainEventOutbox"("processedAt", "deadLetteredAt", "availableAt");
CREATE INDEX "DomainEventOutbox_type_processedAt_createdAt_idx"
  ON "DomainEventOutbox"("type", "processedAt", "createdAt");
CREATE INDEX "DomainEventOutbox_leaseExpiresAt_idx"
  ON "DomainEventOutbox"("leaseExpiresAt");
CREATE INDEX "DomainEventOutbox_projectId_createdAt_idx"
  ON "DomainEventOutbox"("projectId", "createdAt");

CREATE INDEX "DomainEventOutbox_resourceProjectId_sequence_idx"
  ON "DomainEventOutbox"("resourceProjectId", "sequence");
CREATE INDEX "DomainEventOutbox_resourceKind_resourceId_sequence_idx"
  ON "DomainEventOutbox"("resourceKind", "resourceId", "sequence");
