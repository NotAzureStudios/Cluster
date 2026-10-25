-- Program 32A: move source-control, integration, and version ownership out of Project provider fields.
-- Cluster has no active deployed instances at this boundary, so the retired provider-specific columns are removed cleanly.

ALTER TABLE "Project"
  DROP COLUMN "giteaRepoUrl",
  DROP COLUMN "gitProvider",
  DROP COLUMN "gitDefaultBranch",
  DROP COLUMN "discordForumChannelId",
  DROP COLUMN "discordForumThreadId",
  DROP COLUMN "discordForumUrl",
  DROP COLUMN "discordForumTitle";

CREATE TABLE "IntegrationConnection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'configured',
  "configuration" TEXT NOT NULL DEFAULT '{}',
  "secretRefs" TEXT NOT NULL DEFAULT '{}',
  "capabilities" TEXT NOT NULL DEFAULT '[]',
  "healthState" TEXT NOT NULL DEFAULT 'unknown',
  "healthMessage" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceRepository" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "connectionId" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "hostingMode" TEXT NOT NULL DEFAULT 'remote',
  "providerRepositoryId" TEXT,
  "remoteUrl" TEXT,
  "cloneUrl" TEXT,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "healthState" TEXT NOT NULL DEFAULT 'unknown',
  "healthMessage" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceRepository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectSourceBinding" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'primary',
  "branchRole" TEXT NOT NULL DEFAULT 'development',
  "defaultBranch" TEXT,
  "policyOverrides" TEXT NOT NULL DEFAULT '{}',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectSourceBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectIntegrationBinding" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "externalId" TEXT,
  "externalUrl" TEXT,
  "displayName" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectIntegrationBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalEntityLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "connectionId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "providerEntityType" TEXT NOT NULL,
  "providerEntityId" TEXT NOT NULL,
  "providerUrl" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalEntityLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationEventInbox" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationEventInbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationActionReceipt" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "providerEntityId" TEXT,
  "providerUrl" TEXT,
  "responseMetadata" TEXT NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationActionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VersionPolicy" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "presetKey" TEXT NOT NULL DEFAULT 'custom',
  "formatTemplate" TEXT NOT NULL,
  "components" TEXT NOT NULL DEFAULT '[]',
  "orderingRules" TEXT NOT NULL DEFAULT '{}',
  "bumpRules" TEXT NOT NULL DEFAULT '{}',
  "promotionRules" TEXT NOT NULL DEFAULT '{}',
  "projectOverrideAllowed" BOOLEAN NOT NULL DEFAULT false,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VersionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectVersion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "stage" TEXT,
  "components" TEXT NOT NULL DEFAULT '{}',
  "sourceRevision" TEXT,
  "buildId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "releasedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationConnection_workspaceId_providerId_displayName_key" ON "IntegrationConnection"("workspaceId", "providerId", "displayName");
CREATE INDEX "IntegrationConnection_workspaceId_category_archived_updatedAt_idx" ON "IntegrationConnection"("workspaceId", "category", "archived", "updatedAt");
CREATE INDEX "IntegrationConnection_providerId_status_archived_idx" ON "IntegrationConnection"("providerId", "status", "archived");

CREATE UNIQUE INDEX "SourceRepository_workspaceId_name_key" ON "SourceRepository"("workspaceId", "name");
CREATE INDEX "SourceRepository_workspaceId_archived_updatedAt_idx" ON "SourceRepository"("workspaceId", "archived", "updatedAt");
CREATE INDEX "SourceRepository_connectionId_archived_idx" ON "SourceRepository"("connectionId", "archived");
CREATE INDEX "SourceRepository_providerRepositoryId_idx" ON "SourceRepository"("providerRepositoryId");

CREATE UNIQUE INDEX "ProjectSourceBinding_projectId_repositoryId_key" ON "ProjectSourceBinding"("projectId", "repositoryId");
CREATE INDEX "ProjectSourceBinding_projectId_isPrimary_archived_idx" ON "ProjectSourceBinding"("projectId", "isPrimary", "archived");
CREATE INDEX "ProjectSourceBinding_repositoryId_archived_idx" ON "ProjectSourceBinding"("repositoryId", "archived");

CREATE UNIQUE INDEX "ProjectIntegrationBinding_unique_resource" ON "ProjectIntegrationBinding"("projectId", "connectionId", "resourceType", "externalId");
CREATE INDEX "ProjectIntegrationBinding_projectId_resourceType_archived_idx" ON "ProjectIntegrationBinding"("projectId", "resourceType", "archived");
CREATE INDEX "ProjectIntegrationBinding_connectionId_archived_updatedAt_idx" ON "ProjectIntegrationBinding"("connectionId", "archived", "updatedAt");

CREATE UNIQUE INDEX "ExternalEntityLink_unique_entity" ON "ExternalEntityLink"("workspaceId", "entityType", "entityId", "providerEntityType", "providerEntityId");
CREATE INDEX "ExternalEntityLink_projectId_entityType_entityId_idx" ON "ExternalEntityLink"("projectId", "entityType", "entityId");
CREATE INDEX "ExternalEntityLink_connectionId_providerEntityType_providerEntityId_idx" ON "ExternalEntityLink"("connectionId", "providerEntityType", "providerEntityId");

CREATE UNIQUE INDEX "IntegrationEventInbox_connectionId_providerEventId_key" ON "IntegrationEventInbox"("connectionId", "providerEventId");
CREATE INDEX "IntegrationEventInbox_status_receivedAt_idx" ON "IntegrationEventInbox"("status", "receivedAt");
CREATE INDEX "IntegrationEventInbox_connectionId_eventType_receivedAt_idx" ON "IntegrationEventInbox"("connectionId", "eventType", "receivedAt");

CREATE UNIQUE INDEX "IntegrationActionReceipt_connectionId_actionKey_key" ON "IntegrationActionReceipt"("connectionId", "actionKey");
CREATE INDEX "IntegrationActionReceipt_status_createdAt_idx" ON "IntegrationActionReceipt"("status", "createdAt");
CREATE INDEX "IntegrationActionReceipt_entityType_entityId_createdAt_idx" ON "IntegrationActionReceipt"("entityType", "entityId", "createdAt");

CREATE UNIQUE INDEX "VersionPolicy_unique_scope_name" ON "VersionPolicy"("workspaceId", "projectId", "name");
CREATE INDEX "VersionPolicy_workspaceId_projectId_archived_isDefault_idx" ON "VersionPolicy"("workspaceId", "projectId", "archived", "isDefault");

CREATE UNIQUE INDEX "ProjectVersion_projectId_label_key" ON "ProjectVersion"("projectId", "label");
CREATE INDEX "ProjectVersion_projectId_status_createdAt_idx" ON "ProjectVersion"("projectId", "status", "createdAt");
CREATE INDEX "ProjectVersion_policyId_createdAt_idx" ON "ProjectVersion"("policyId", "createdAt");
CREATE INDEX "ProjectVersion_sourceRevision_idx" ON "ProjectVersion"("sourceRevision");

ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRepository" ADD CONSTRAINT "SourceRepository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRepository" ADD CONSTRAINT "SourceRepository_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectSourceBinding" ADD CONSTRAINT "ProjectSourceBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSourceBinding" ADD CONSTRAINT "ProjectSourceBinding_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectIntegrationBinding" ADD CONSTRAINT "ProjectIntegrationBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectIntegrationBinding" ADD CONSTRAINT "ProjectIntegrationBinding_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalEntityLink" ADD CONSTRAINT "ExternalEntityLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalEntityLink" ADD CONSTRAINT "ExternalEntityLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalEntityLink" ADD CONSTRAINT "ExternalEntityLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationEventInbox" ADD CONSTRAINT "IntegrationEventInbox_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationActionReceipt" ADD CONSTRAINT "IntegrationActionReceipt_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VersionPolicy" ADD CONSTRAINT "VersionPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VersionPolicy" ADD CONSTRAINT "VersionPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "VersionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
