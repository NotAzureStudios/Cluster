-- Program 33A: connection-owned source-provider secrets and provider-neutral external links.
CREATE TABLE "IntegrationConnectionSecret" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationConnectionSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationConnectionSecret_connectionId_key_key"
    ON "IntegrationConnectionSecret"("connectionId", "key");
CREATE INDEX "IntegrationConnectionSecret_connectionId_updatedAt_idx"
    ON "IntegrationConnectionSecret"("connectionId", "updatedAt");
ALTER TABLE "IntegrationConnectionSecret"
    ADD CONSTRAINT "IntegrationConnectionSecret_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Card"
    DROP COLUMN IF EXISTS "giteaIssueUrl",
    DROP COLUMN IF EXISTS "giteaIssueNumber",
    DROP COLUMN IF EXISTS "giteaIssueTitle",
    DROP COLUMN IF EXISTS "giteaIssueState",
    DROP COLUMN IF EXISTS "giteaIssueLabels",
    DROP COLUMN IF EXISTS "giteaIssueAssignee",
    DROP COLUMN IF EXISTS "giteaIssueUpdatedAt",
    DROP COLUMN IF EXISTS "discordMessageUrl";
