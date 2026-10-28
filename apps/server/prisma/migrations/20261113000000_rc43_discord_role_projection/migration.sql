-- Outbound-only Discord role ownership ledger.
-- No Discord roles grant Cluster permissions.
CREATE TABLE "DiscordRoleProjection" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userId" TEXT,
  "discordUserId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "grantedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscordRoleProjection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscordRoleProjection_connectionId_guildId_discordUserId_roleId_key"
 ON "DiscordRoleProjection"("connectionId","guildId","discordUserId","roleId");
CREATE INDEX "DiscordRoleProjection_connectionId_guildId_status_idx"
 ON "DiscordRoleProjection"("connectionId","guildId","status");
CREATE INDEX "DiscordRoleProjection_userId_status_idx"
 ON "DiscordRoleProjection"("userId","status");
ALTER TABLE "DiscordRoleProjection" ADD CONSTRAINT "DiscordRoleProjection_connectionId_fkey"
 FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscordRoleProjection" ADD CONSTRAINT "DiscordRoleProjection_userId_fkey"
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
