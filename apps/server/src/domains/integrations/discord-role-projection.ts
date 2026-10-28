import { randomUUID } from "node:crypto";
import type { SettingPayload } from "../../app/server-composition-types.js";
import { createHttpError } from "../../core/http-errors.js";

// One-way identity labels only. Discord permissions are never imported as
// Cluster permissions. Roles with guild-wide privileges are not eligible.
export type DiscordRoleMapping = {
  id: string;
  guildId: string;
  roleId: string;
  sourceKind: "accountType" | "team";
  sourceId: string;
};

type Input = {
  prisma: any;
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  discordRequest: (settings: SettingPayload, path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  logger?: { warn?: (data: unknown, message?: string) => void };
};
const SNOWFLAKE = /^\d{8,24}$/;
const SOURCE = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_MAPPINGS = 24;
const MAX_CHANGE_BATCH = 25;
const ACCOUNT_TYPES = ["employee", "internal", "contractor", "guest", "service", "device"];
function configOf(connection: any) {
  try { const parsed = JSON.parse(String(connection?.configuration || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
function mappingsOf(config: any): DiscordRoleMapping[] {
  if (!Array.isArray(config?.discordRoleMappings)) return [];
  return config.discordRoleMappings.filter((r: any) => r && typeof r.id === "string" && SNOWFLAKE.test(r.guildId) && SNOWFLAKE.test(r.roleId)
    && (r.sourceKind === "accountType" || r.sourceKind === "team") && typeof r.sourceId === "string").slice(0, MAX_MAPPINGS);
}
function allowedGuilds(config: any, primary: unknown) {
  return new Set([String(primary || ""), ...(Array.isArray(config.authorizedGuildIds) ? config.authorizedGuildIds.map(String) : [])].filter((id) => SNOWFLAKE.test(id)));
}
function isEligible(user: any) {
  return user && user.accountState === "ACTIVE" && !user.archived && (!user.accessExpiresAt || new Date(user.accessExpiresAt) > new Date())
    && SNOWFLAKE.test(String(user.discordUserId || ""));
}
function owned(record: any) { return record.status === "managed" || record.status === "revoking"; }
function key(discordUserId: string, roleId: string) { return `${discordUserId}:${roleId}`; }

/** Pure planning function. Only records confirmed managed by Cluster can be revoked. */
export function planDiscordRoleChanges(desired: Map<string, { userId: string; discordUserId: string; roleId: string }>, records: any[]) {
  const revokes = records.filter((record) => owned(record) && !desired.has(key(String(record.discordUserId), String(record.roleId))));
  const existing = new Set(records.filter(owned).map((record) => key(String(record.discordUserId), String(record.roleId))));
  const pending = new Set(records.filter((record) => record.status === "pending" || record.status === "uncertain" || record.status === "external")
    .map((record) => key(String(record.discordUserId), String(record.roleId))));
  const grants = [...desired.entries()].filter(([k]) => !existing.has(k) && !pending.has(k)).map(([, value]) => value);
  return { grants, revokes, uncertain: records.filter((record) => record.status === "pending" || record.status === "uncertain").length };
}

export function createDiscordRoleProjectionService(input: Input) {
  let applying = false;
  async function connection() {
    const found = await input.prisma.integrationConnection.findFirst({ where: { providerId: "communication.discord", archived: false, status: { not: "disabled" } }, orderBy: { createdAt: "asc" } });
    if (!found) throw createHttpError("DISCORD_CONNECTION_NOT_FOUND", "Configure Discord first.", 409);
    return found;
  }
  async function context() {
    const [conn, settings] = await Promise.all([connection(), input.readSettings()]);
    const config = configOf(conn);
    return { conn, config, settings, guilds: allowedGuilds(config, settings.discordGuildId) };
  }
  async function writeMappings(conn: any, config: any, mappings: DiscordRoleMapping[], enabled?: boolean) {
    // Optimistic comparison prevents a concurrent admin save from discarding
    // guild allowlist or bot-manager flags stored in the same JSON column.
    const next = { ...config, discordRoleMappings: mappings, discordRoleSyncEnabled: enabled ?? config.discordRoleSyncEnabled === true };
    const result = await input.prisma.integrationConnection.updateMany({
      where: { id: conn.id, configuration: conn.configuration }, data: { configuration: JSON.stringify(next) },
    });
    if (result.count !== 1) throw createHttpError("DISCORD_ROLE_CONFIG_STALE", "Discord settings changed. Refresh and retry.", 409);
  }
  async function getRoles(guildId: string, settings: SettingPayload) {
    const roles = await input.discordRequest(settings, `/guilds/${guildId}/roles`);
    if (!Array.isArray(roles)) throw createHttpError("DISCORD_ROLES_UNAVAILABLE", "Discord did not return the server roles.", 502);
    return roles as any[];
  }
  function safeRole(roles: any[], guildId: string, roleId: string) {
    const role = roles.find((value) => String(value.id) === roleId);
    if (!role || roleId === guildId || role.managed || BigInt(String(role.permissions || "0")) !== 0n)
      throw createHttpError("DISCORD_ROLE_UNSAFE", "Choose a regular Discord role with no server-level permissions. Server-managed, @everyone and privileged roles cannot be mapped.", 400);
    return role;
  }
  async function list(guildId?: string) {
    const { config, guilds, settings, conn } = await context();
    const mappings = mappingsOf(config);
    const matchingGuild = guildId || [...guilds][0] || "";
    if (matchingGuild && !guilds.has(matchingGuild)) throw createHttpError("DISCORD_GUILD_NOT_APPROVED", "Discord server is not approved.", 403);
    const roles = matchingGuild ? (await getRoles(matchingGuild, settings)).filter((role) => {
      try { safeRole([role], matchingGuild, String(role.id)); return true; } catch { return false; }
    }).map((role) => ({ id: String(role.id), name: String(role.name || role.id), color: Number(role.color || 0), position: Number(role.position || 0) })) : [];
    const teams = await input.prisma.studioTeam.findMany({ where: { workspaceId: conn.workspaceId, archived: false }, select: { id: true, name: true }, take: 200, orderBy: { name: "asc" } });
    const managed = await input.prisma.discordRoleProjection.count({ where: { connectionId: conn.id, status: { in: ["managed", "revoking"] } } });
    const uncertain = await input.prisma.discordRoleProjection.count({ where: { connectionId: conn.id, status: { in: ["pending", "uncertain"] } } });
    return { enabled: config.discordRoleSyncEnabled === true, mappings, roles, teams, accountTypes: ACCOUNT_TYPES, managed, uncertain };
  }
  async function addMapping(data: { guildId: string; roleId: string; sourceKind: "accountType" | "team"; sourceId: string }) {
    const { conn, config, settings, guilds } = await context();
    if (!guilds.has(data.guildId)) throw createHttpError("DISCORD_GUILD_NOT_APPROVED", "Approve the Discord server first.", 403);
    if (!SNOWFLAKE.test(data.roleId) || !SOURCE.test(data.sourceId) || !["accountType", "team"].includes(data.sourceKind))
      throw createHttpError("DISCORD_MAPPING_INVALID", "Choose a valid role and source.", 400);
    if (data.sourceKind === "accountType" && !ACCOUNT_TYPES.includes(data.sourceId)) throw createHttpError("DISCORD_ACCOUNT_TYPE_INVALID", "Unsupported account type.", 400);
    if (data.sourceKind === "team" && !(await input.prisma.studioTeam.findFirst({ where: { id: data.sourceId, workspaceId: conn.workspaceId, archived: false } })))
      throw createHttpError("DISCORD_TEAM_NOT_FOUND", "Choose an active team in this studio.", 404);
    safeRole(await getRoles(data.guildId, settings), data.guildId, data.roleId);
    const mappings = mappingsOf(config);
    if (mappings.length >= MAX_MAPPINGS) throw createHttpError("DISCORD_ROLE_MAP_LIMIT", "Maximum 24 role mappings.", 409);
    if (mappings.some((m) => m.guildId === data.guildId && m.roleId === data.roleId && m.sourceKind === data.sourceKind && m.sourceId === data.sourceId))
      throw createHttpError("DISCORD_MAPPING_DUPLICATE", "That mapping already exists.", 409);
    await writeMappings(conn, config, [...mappings, { ...data, id: randomUUID() }]);
    return { saved: true };
  }
  async function removeMapping(id: string) {
    const { conn, config } = await context();
    const mappings = mappingsOf(config);
    if (!mappings.some((m) => m.id === id)) throw createHttpError("DISCORD_MAPPING_NOT_FOUND", "Role mapping not found.", 404);
    await writeMappings(conn, config, mappings.filter((m) => m.id !== id));
    return { removed: true, message: "Role mapping removed. Next reconciliation revokes only roles previously assigned by Cluster." };
  }
  async function setEnabled(enabled: boolean) {
    const { conn, config } = await context();
    await writeMappings(conn, config, mappingsOf(config), enabled);
    return { enabled };
  }
  async function plan() {
    const { conn, config, guilds } = await context();
    const mappings = mappingsOf(config).filter((map) => guilds.has(map.guildId));
    const memberships = await input.prisma.workspaceMember.findMany({ where: { workspaceId: conn.workspaceId }, include: { user: true }, take: 2001 });
    if (memberships.length > 2000) throw createHttpError("DISCORD_ROLE_SCOPE_TOO_LARGE", "Role sync supports up to 2000 studio members per pass.", 409);
    const teamMappings = mappings.filter((map) => map.sourceKind === "team");
    const teamMemberships = teamMappings.length ? await input.prisma.studioTeamMember.findMany({
      where: { teamId: { in: teamMappings.map((m) => m.sourceId) }, archived: false, team: { workspaceId: conn.workspaceId, archived: false } },
      select: { userId: true, teamId: true }, take: 10001,
    }) : [];
    if (teamMemberships.length > 10000) throw createHttpError("DISCORD_ROLE_TEAM_SCOPE_TOO_LARGE", "Too many team memberships for a single reconciliation.", 409);
    const teamLookup = new Set(teamMemberships.map((m: any) => `${m.userId}:${m.teamId}`));
    const desired = new Map<string, Map<string, { userId: string; discordUserId: string; roleId: string }>>();
    for (const map of mappings) desired.set(map.guildId, new Map());
    for (const row of memberships) {
      const user = row.user;
      if (!isEligible(user)) continue;
      for (const map of mappings) {
        if (map.sourceKind === "accountType" ? user.accountType !== map.sourceId : !teamLookup.has(`${user.id}:${map.sourceId}`)) continue;
        desired.get(map.guildId)!.set(key(user.discordUserId, map.roleId), { userId: user.id, discordUserId: user.discordUserId, roleId: map.roleId });
      }
    }
    const records = await input.prisma.discordRoleProjection.findMany({ where: { connectionId: conn.id, status: { in: ["managed", "pending", "uncertain", "revoking", "external"] } }, take: 5001 });
    if (records.length > 5000) throw createHttpError("DISCORD_ROLE_LEDGER_TOO_LARGE", "Too many managed roles for one pass.", 409);
    // A revoked guild is *never* a valid grant target. Existing Cluster-owned
    // entries must still be revoked on the Discord side when possible.
    const guildIds = new Set([...desired.keys(), ...records.map((r: any) => String(r.guildId))]);
    const changes = [] as Array<{ guildId: string; grants: any[]; revokes: any[]; uncertain: number }>;
    for (const guildId of guildIds) {
      const guildRecords = records.filter((r: any) => r.guildId === guildId);
      const change = planDiscordRoleChanges(desired.get(guildId) || new Map(), guildRecords);
      changes.push({ guildId, ...change });
    }
    return { enabled: config.discordRoleSyncEnabled === true, connectionId: conn.id, changes, mappedGuilds: [...new Set(mappings.map((m) => m.guildId))], totalGrants: changes.reduce((n, x) => n + x.grants.length, 0), totalRevokes: changes.reduce((n, x) => n + x.revokes.length, 0), uncertain: changes.reduce((n, x) => n + x.uncertain, 0) };
  }
  async function botPermissions(settings: SettingPayload, guildId: string, roles: any[]) {
    const bot = await input.discordRequest(settings, "/users/@me");
    const member = await input.discordRequest(settings, `/guilds/${guildId}/members/${String(bot.id)}`);
    const botRoleIds = new Set((member.roles || []).map(String));
    const owned = roles.filter((role) => role.id === guildId || botRoleIds.has(String(role.id)));
    const effective = owned.reduce((permissions, role) => permissions | BigInt(String(role.permissions || "0")), 0n);
    if (!(effective & (1n << 28n)) && !(effective & (1n << 3n)))
      throw createHttpError("DISCORD_BOT_MANAGE_ROLES_REQUIRED", "Discord bot needs Manage Roles permission.", 409);
    return Math.max(0, ...owned.filter((role) => role.id !== guildId).map((role) => Number(role.position || 0)));
  }
  async function reconcile() {
    if (applying) throw createHttpError("DISCORD_ROLE_RECONCILE_BUSY", "Role reconciliation is already running.", 409);
    applying = true;
    try {
      // Disabled means zero planned writes and no bulk workforce queries.
      const current = await context();
      if (current.config.discordRoleSyncEnabled !== true) return { enabled: false, applied: 0, skipped: 0, failed: 0, remaining: 0, uncertain: 0, errors: [], message: "Role synchronization is disabled; preview is available." };
      const planned = await plan();
      const settings = await input.readSettings(true);
      let applied = 0, skipped = 0, failed = 0;
      const errors: string[] = [];
      const operations = [
        ...planned.changes.flatMap((g) => g.revokes.map((row) => ({ guildId: g.guildId, kind: "revoke" as const, row }))),
        ...planned.changes.flatMap((g) => g.grants.map((row) => ({ guildId: g.guildId, kind: "grant" as const, row }))),
      ].slice(0, MAX_CHANGE_BATCH);
      const gate = new Map<string, { roles: any[]; maxPosition: number }>();
      for (const op of operations) {
        try {
          let ctx = gate.get(op.guildId);
          if (!ctx) {
            const roles = await getRoles(op.guildId, settings);
            ctx = { roles, maxPosition: await botPermissions(settings, op.guildId, roles) };
            gate.set(op.guildId, ctx);
          }
          const role = ctx.roles.find((r) => String(r.id) === op.row.roleId);
          if (!role || Number(role.position || 0) >= ctx.maxPosition) throw createHttpError("DISCORD_BOT_ROLE_HIERARCHY", "Bot role must be above the mapped role.", 409);
          if (op.kind === "revoke") {
            // Never delete a role unless a confirmed grant belongs to Cluster.
            const reserved = await input.prisma.discordRoleProjection.updateMany({ where: { id: op.row.id, status: "managed" }, data: { status: "revoking" } });
            if (reserved.count !== 1 && op.row.status !== "revoking") { skipped++; continue; }
            try {
              await input.discordRequest(settings, `/guilds/${op.guildId}/members/${op.row.discordUserId}/roles/${op.row.roleId}`, { method: "DELETE" });
              await input.prisma.discordRoleProjection.update({ where: { id: op.row.id }, data: { status: "revoked", revokedAt: new Date(), lastError: null } });
              applied++;
            } catch (error: any) {
              // Retryable, idempotent DELETE. Remain owned until confirmed removed.
              await input.prisma.discordRoleProjection.update({ where: { id: op.row.id }, data: { status: "managed", lastError: String(error?.message || error).slice(0, 500) } });
              throw error;
            }
          } else {
            safeRole(ctx.roles, op.guildId, op.row.roleId);
            // Re-check identity immediately before the Discord API mutation;
            // disabled/expired/unlinked users can never receive a new grant.
            const latest = await input.prisma.user.findUnique({ where: { id: op.row.userId } });
            const current = await context();
            const candidateMappings = mappingsOf(current.config).filter((m) => m.guildId === op.guildId && m.roleId === op.row.roleId);
            const inStudio = await input.prisma.workspaceMember.findFirst({ where: { workspaceId: current.conn.workspaceId, userId: op.row.userId } });
            const matching = [] as DiscordRoleMapping[];
            for (const map of candidateMappings) {
              if (map.sourceKind === "accountType" && latest?.accountType === map.sourceId) matching.push(map);
              if (map.sourceKind === "team" && await input.prisma.studioTeamMember.findFirst({ where: { userId: op.row.userId, teamId: map.sourceId, archived: false, team: { workspaceId: current.conn.workspaceId, archived: false } } })) matching.push(map);
            }
            if (!current.config.discordRoleSyncEnabled || !current.guilds.has(op.guildId) || !matching.length || !inStudio || !isEligible(latest) || latest.discordUserId !== op.row.discordUserId) { skipped++; continue; }
            const member = await input.discordRequest(settings, `/guilds/${op.guildId}/members/${op.row.discordUserId}`);
            if ((member.roles || []).map(String).includes(op.row.roleId)) {
              // Durable non-ownership receipt prevents repeated provider checks
              // and prevents one pre-existing role from starving later batches.
              try {
                await input.prisma.discordRoleProjection.create({ data: { connectionId: planned.connectionId, userId: op.row.userId,
                  discordUserId: op.row.discordUserId, guildId: op.guildId, roleId: op.row.roleId, status: "external" } });
              } catch (error: any) { if (error?.code !== "P2002") throw error; }
              skipped++; continue;
            }
            let reserved;
            const previous = await input.prisma.discordRoleProjection.findFirst({ where: { connectionId: planned.connectionId, guildId: op.guildId, discordUserId: op.row.discordUserId, roleId: op.row.roleId } });
            if (previous?.status === "revoked") {
              const reopened = await input.prisma.discordRoleProjection.updateMany({ where: { id: previous.id, status: "revoked" }, data: { status: "pending", revokedAt: null, lastError: null, userId: op.row.userId } });
              if (reopened.count !== 1) { skipped++; continue; }
              reserved = { id: previous.id };
            } else {
              try {
                reserved = await input.prisma.discordRoleProjection.create({ data: { connectionId: planned.connectionId, userId: op.row.userId, discordUserId: op.row.discordUserId, guildId: op.guildId, roleId: op.row.roleId, status: "pending" } });
              } catch (error: any) {
                // Another run owns this key, or an old uncertain grant needs manual review.
                if (error?.code === "P2002") { skipped++; continue; }
                throw error;
              }
            }
            try {
              await input.discordRequest(settings, `/guilds/${op.guildId}/members/${op.row.discordUserId}/roles/${op.row.roleId}`, { method: "PUT" });
              await input.prisma.discordRoleProjection.update({ where: { id: reserved.id }, data: { status: "managed", grantedAt: new Date(), lastError: null } });
              applied++;
            } catch (error: any) {
              // A timed-out PUT might have succeeded on Discord. NEVER claim
              // ownership or auto-remove an uncertain grant without review.
              await input.prisma.discordRoleProjection.update({ where: { id: reserved.id }, data: { status: "uncertain", lastError: String(error?.message || error).slice(0, 500) } }).catch(() => undefined);
              throw error;
            }
          }
        } catch (error: any) {
          failed++;
          errors.push(`${op.guildId}: ${String(error?.message || error).slice(0, 160)}`);
          input.logger?.warn?.({ guildId: op.guildId, operation: op.kind, error: String(error?.message || error) }, "Discord role projection failed");
        }
      }
      return { enabled: true, applied, skipped, failed, errors: errors.slice(0, 5), remaining: Math.max(0, planned.totalGrants + planned.totalRevokes - operations.length), uncertain: planned.uncertain };
    } finally { applying = false; }
  }
  return { list, addMapping, removeMapping, setEnabled, plan, reconcile };
}
