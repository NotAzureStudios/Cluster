-- PostgreSQL retains at most 63 bytes per identifier.
-- RC43 created a 67-byte index name, silently truncated by PostgreSQL.
-- Rename its existing UNIQUE index without dropping or recreating it.
-- This migration is safe for databases initialized by RC44 as well as upgrades.
ALTER INDEX "DiscordRoleProjection_connectionId_guildId_discordUserId_roleId"
  RENAME TO "DiscordRoleProjection_owner_key";
