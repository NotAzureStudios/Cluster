ALTER TABLE "ApiMutationReceipt"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "correlationId" TEXT;

CREATE INDEX "ApiMutationReceipt_workspaceId_createdAt_idx"
  ON "ApiMutationReceipt"("workspaceId", "createdAt");
CREATE INDEX "ApiMutationReceipt_correlationId_idx"
  ON "ApiMutationReceipt"("correlationId");

ALTER TABLE "DomainEventOutbox"
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "causationId" TEXT;

CREATE INDEX "DomainEventOutbox_workspaceId_sequence_idx"
  ON "DomainEventOutbox"("workspaceId", "sequence");
CREATE INDEX "DomainEventOutbox_correlationId_sequence_idx"
  ON "DomainEventOutbox"("correlationId", "sequence");

ALTER TABLE "BackgroundJob"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "causationId" TEXT;

CREATE INDEX "BackgroundJob_workspaceId_queue_status_runAfter_idx"
  ON "BackgroundJob"("workspaceId", "queue", "status", "runAfter");
CREATE INDEX "BackgroundJob_correlationId_createdAt_idx"
  ON "BackgroundJob"("correlationId", "createdAt");

ALTER TABLE "IntegrationWebhookEndpoint"
  ADD COLUMN "workspaceId" TEXT;

CREATE INDEX "IntegrationWebhookEndpoint_workspaceId_enabled_projectId_createdAt_idx"
  ON "IntegrationWebhookEndpoint"("workspaceId", "enabled", "projectId", "createdAt");
