import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { expectedServerConfigFields } from "../../core/server-config-preconditions.js";
import type { SettingPayload } from "../../app/server-composition-types.js";
import type { IntegrationProviderRegistry } from "./integration-provider-registry.js";
import { createIntegrationProviderHealthService } from "./integration-provider-health.js";
import { createHttpError } from "../../core/http-errors.js";
import { validateDiscordWebhookUrl } from "../../core/security.js";
import type { SourceProviderService, SourceProviderId } from "../source-control/source-provider-service.js";
import { validateRepositoryHosting } from "../source-control/repository-hosting-policy.js";

const CONNECTION_CATEGORIES = ["source-control", "communication", "media", "automation", "calendar", "build", "storage"] as const;
const VERSION_PRESETS = ["semantic", "game-development", "calendar", "film-vfx", "simple-revision", "custom"] as const;

function parseObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeConnection(row: any) {
  return { ...row, configuration: parseObject(row.configuration), secretRefs: parseObject(row.secretRefs), capabilities: parseArray(row.capabilities) };
}

function serializeRepository(row: any) {
  return { ...row, metadata: parseObject(row.metadata), connection: row.connection ? serializeConnection(row.connection) : null };
}

function serializeVersionPolicy(row: any) {
  return {
    ...row,
    components: parseArray(row.components),
    orderingRules: parseObject(row.orderingRules),
    bumpRules: parseObject(row.bumpRules),
    promotionRules: parseObject(row.promotionRules),
  };
}

async function activeWorkspace(prisma: any) {
  const workspace = await prisma.workspace.findFirst({ where: { archived: false }, orderBy: { createdAt: "asc" } });
  if (!workspace) throw createHttpError("WORKSPACE_NOT_READY", "Complete studio setup before configuring integrations.", 409);
  return workspace;
}

export function registerIntegrationRoutes(input: {
  app: FastifyInstance;
  prisma: any;
  registry: IntegrationProviderRegistry;
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  saveSettings: (settings: SettingPayload, options?: { changedFields: SettingPayload; expectedSettings: Record<string, { exists: boolean; value?: unknown }> }) => Promise<unknown>;
  settingsForClient: (settings: SettingPayload) => Record<string, unknown>;
  authorization: { requireTool: (request: FastifyRequest, reply: FastifyReply, tool: string, minimum?: string) => Promise<any | null> };
  sourceProvider: SourceProviderService;
  logActivity?: (input: any) => Promise<any>;
  discordRequest?: (settings: SettingPayload, path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
}) {
  const health = createIntegrationProviderHealthService({
    registry: input.registry,
    readSettings: input.readSettings,
    discordRequest: input.discordRequest,
  });
  const recordIntegrationChange = async (resourceKind: "integration_connection" | "source_repository", resourceId: string, type: string, title: string, metadata: Record<string, unknown> = {}) => {
    if (!input.logActivity) return;
    await input.logActivity({ userId: null, projectId: null, type, entityType: resourceKind, entityId: resourceId, title, metadata }).catch(() => undefined);
  };

  input.app.get("/api/admin/integrations/providers", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "integrations", "view");
    if (!viewer) return;
    const workspace = await activeWorkspace(input.prisma);
    const [snapshots, sourceConnections] = await Promise.all([
      health.snapshot(),
      input.prisma.integrationConnection.findMany({ where: { workspaceId: workspace.id, category: "source-control", archived: false }, select: { providerId: true, status: true, healthState: true, healthMessage: true, lastCheckedAt: true } }),
    ]);
    const providers = snapshots.map((provider: any) => {
      if (provider.category !== "source-control") return provider;
      const matches = sourceConnections.filter((connection: any) => connection.providerId === provider.id && connection.status !== "disabled");
      const healthy = matches.some((connection: any) => connection.healthState === "healthy");
      const needsAttention = matches.some((connection: any) => ["failed", "degraded", "error"].includes(String(connection.healthState || "")));
      return { ...provider, configured: matches.length > 0, health: { providerId: provider.id, state: !matches.length ? "misconfigured" : healthy ? "healthy" : needsAttention ? "degraded" : "unknown", checkedAt: matches.map((item: any) => item.lastCheckedAt).filter(Boolean).sort().pop() || new Date().toISOString(), latencyMs: 0, detail: !matches.length ? "Add a Source Control connection to use this provider." : matches.find((item: any) => item.healthMessage)?.healthMessage || `${matches.length} Source Control connection${matches.length === 1 ? "" : "s"} configured.`, live: false } };
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, contractVersion: 4, executionModel: "trusted-server-registration-only", dynamicCodeLoading: false, permissionModel: { tool: "integrations", reads: "view", writes: "manage" }, providers };
  });

  input.app.get("/api/admin/integrations/providers/:providerId/health", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "integrations", "view");
    if (!viewer) return;
    const { providerId } = z.object({ providerId: z.string().trim().min(1).max(80) }).parse(request.params);
    const manifest = input.registry.get(providerId);
    if (!manifest) return reply.code(404).send({ ok: false, code: "INTEGRATION_PROVIDER_NOT_FOUND", error: "Integration provider not found." });
    if (manifest.category === "source-control") {
      const workspace = await activeWorkspace(input.prisma);
      const connection = await input.prisma.integrationConnection.findFirst({ where: { workspaceId: workspace.id, providerId, category: "source-control", archived: false, status: { not: "disabled" } }, orderBy: { createdAt: "asc" } });
      if (!connection) return { ok: true, contractVersion: 4, health: { providerId, state: "misconfigured", checkedAt: new Date().toISOString(), latencyMs: 0, detail: "Add a Source Control connection to use this provider.", live: false } };
      const startedAt = Date.now();
      try {
        await input.sourceProvider.testConnection(connection);
        return { ok: true, contractVersion: 4, health: { providerId, state: "healthy", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: "Source Control connection verified.", live: true } };
      } catch (error) {
        return { ok: true, contractVersion: 4, health: { providerId, state: "degraded", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, detail: error instanceof Error ? error.message.slice(0, 500) : "Source Control connection check failed.", live: true } };
      }
    }
    const providerHealth = await health.check(providerId);
    reply.header("Cache-Control", "no-store");
    return { ok: true, contractVersion: 4, health: providerHealth };
  });

  input.app.get("/api/admin/source-control/connections", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "sourceControl", "view");
    if (!viewer) return;
    const workspace = await activeWorkspace(input.prisma);
    const rows = await input.prisma.integrationConnection.findMany({
      where: { workspaceId: workspace.id, category: "source-control", archived: false },
      orderBy: [{ providerId: "asc" }, { displayName: "asc" }],
    });
    return { ok: true, connections: await Promise.all(rows.map(async (row: any) => ({ ...serializeConnection(row), configuration: await input.sourceProvider.serializeConfiguration(row) }))) };
  });

  input.app.post("/api/admin/source-control/connections", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const body = z.object({
      providerId: z.enum(["source.gitea", "source.forgejo", "source.github", "source.gitlab"]),
      displayName: z.string().trim().min(1).max(120),
      baseUrl: z.string().trim().max(2048).optional().default(""),
      apiBaseUrl: z.string().trim().max(2048).optional().default(""),
      allowPrivateNetwork: z.boolean().optional().default(false),
      token: z.string().max(4096).optional(),
    }).parse(request.body || {});
    const workspace = await activeWorkspace(input.prisma);
    const provider = input.registry.get(body.providerId);
    if (!provider || provider.implementation !== "active") throw createHttpError("INTEGRATION_PROVIDER_UNAVAILABLE", "The selected Source Control provider is unavailable.", 409);
    const connection = await input.sourceProvider.configureConnection({ workspaceId: workspace.id, providerId: body.providerId as SourceProviderId, displayName: body.displayName, baseUrl: body.baseUrl || null, apiBaseUrl: body.apiBaseUrl || null, allowPrivateNetwork: body.allowPrivateNetwork, token: body.token || null, capabilities: provider.capabilities });
    await recordIntegrationChange("integration_connection", connection.id, "integration_connection_created", "Source Control connection created", { providerId: connection.providerId });
    return reply.code(201).send({ ok: true, connection: { ...serializeConnection(connection), configuration: await input.sourceProvider.serializeConfiguration(connection) } });
  });

  input.app.patch("/api/admin/source-control/connections/:connectionId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(request.params);
    const existing = await input.prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!existing || existing.archived || existing.category !== "source-control") throw createHttpError("SOURCE_CONNECTION_NOT_FOUND", "Source Control connection not found.", 404);
    const body = z.object({
      displayName: z.string().trim().min(1).max(120).optional(),
      baseUrl: z.string().trim().max(2048).optional(),
      apiBaseUrl: z.string().trim().max(2048).optional(),
      allowPrivateNetwork: z.boolean().optional(),
      token: z.string().max(4096).optional(),
      clearToken: z.boolean().optional().default(false),
      status: z.enum(["configured", "disabled"]).optional(),
    }).parse(request.body || {});
    const provider = input.registry.get(existing.providerId);
    if (!provider || provider.implementation !== "active") throw createHttpError("INTEGRATION_PROVIDER_UNAVAILABLE", "The selected Source Control provider is unavailable.", 409);
    const currentConfig = await input.sourceProvider.serializeConfiguration(existing);
    const connection = await input.sourceProvider.configureConnection({ workspaceId: existing.workspaceId, connectionId, providerId: existing.providerId as SourceProviderId, displayName: body.displayName || existing.displayName, baseUrl: body.baseUrl ?? currentConfig.baseUrl, apiBaseUrl: body.apiBaseUrl ?? currentConfig.apiBaseUrl, allowPrivateNetwork: body.allowPrivateNetwork ?? currentConfig.allowPrivateNetwork, token: body.token || null, clearToken: body.clearToken, capabilities: provider.capabilities });
    const final = body.status ? await input.prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: body.status } }) : connection;
    await recordIntegrationChange("integration_connection", final.id, "integration_connection_updated", "Source Control connection updated", { providerId: final.providerId });
    return { ok: true, connection: { ...serializeConnection(final), configuration: await input.sourceProvider.serializeConfiguration(final) } };
  });

  input.app.post("/api/admin/source-control/connections/:connectionId/check", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(request.params);
    const result = await input.sourceProvider.testConnection(connectionId);
    await recordIntegrationChange("integration_connection", connectionId, "integration_connection_checked", "Source Control connection checked");
    return { ok: true, health: result };
  });

  input.app.get("/api/admin/discord/configuration", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "integrations", "view");
    if (!viewer) return;
    const workspace = await activeWorkspace(input.prisma);
    const settings = await input.readSettings();
    const connection = await input.prisma.integrationConnection.findFirst({
      where: { workspaceId: workspace.id, providerId: "communication.discord", archived: false },
      orderBy: { createdAt: "asc" },
    });
    return {
      ok: true,
      connection: connection ? serializeConnection(connection) : null,
      configuration: {
        guildId: settings.discordGuildId || "",
        forumChannelId: settings.discordForumChannelId || "",
        chatChannelId: settings.discordChatChannelId || "",
        adminRoleId: settings.discordAdminRoleId || "",
        messagePrefix: settings.discordMessagePrefix || "Cluster",
        applicationId: settings.discordApplicationId || "",
        applicationPublicKeyConfigured: Boolean(settings.discordApplicationPublicKey),
        oauthConfigured: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && (process.env.DISCORD_REDIRECT_URI || process.env.NODE_ENV !== "production")),
        oauthRedirectUri: process.env.DISCORD_REDIRECT_URI || "",
        oauthApplicationMatches: !settings.discordApplicationId || !process.env.DISCORD_CLIENT_ID || settings.discordApplicationId === process.env.DISCORD_CLIENT_ID,
        botTokenConfigured: Boolean(settings.discordBotToken),
        webhookConfigured: Boolean(settings.discordWebhookUrl),
      },
    };
  });

  input.app.put("/api/admin/discord/configuration", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const body = z.object({
      displayName: z.string().trim().min(1).max(120).default("Studio Discord"),
      guildId: z.string().trim().max(120).refine((value) => !value || /^\d{8,24}$/.test(value), "Discord server ID must be numeric.").default(""),
      forumChannelId: z.string().trim().max(120).default(""),
      chatChannelId: z.string().trim().max(120).default(""),
      adminRoleId: z.string().trim().max(120).default(""),
      messagePrefix: z.string().trim().max(80).default("Cluster"),
      applicationId: z.string().trim().max(120).refine((value) => !value || /^\d{8,24}$/.test(value), "Discord application ID must be numeric.").default(""),
      applicationPublicKey: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, "Discord application public key must be 64 hexadecimal characters.").optional(),
      botToken: z.string().max(4096).optional(),
      webhookUrl: z.string().trim().max(4096).optional(),
      clearApplicationPublicKey: z.boolean().optional().default(false),
      clearBotToken: z.boolean().optional().default(false),
      clearWebhook: z.boolean().optional().default(false),
    }).parse(request.body || {});
    const workspace = await activeWorkspace(input.prisma);
    const provider = input.registry.get("communication.discord");
    if (!provider || provider.implementation !== "active") throw createHttpError("INTEGRATION_PROVIDER_UNAVAILABLE", "The Discord adapter is unavailable.", 409);
    const existingSettings = await input.readSettings();
    const webhook = body.webhookUrl?.trim() ? validateDiscordWebhookUrl(body.webhookUrl.trim()) : undefined;
    // Named-field commit: old form snapshots must not overwrite unrelated settings.
    // Unspecified secrets are not submitted at all, preventing cached redacted
    // placeholders from replacing a live token. Explicit clear is intentional.
    const changes: SettingPayload = {
      discordGuildId: body.guildId,
      discordForumChannelId: body.forumChannelId,
      discordChatChannelId: body.chatChannelId,
      discordAdminRoleId: body.adminRoleId,
      discordMessagePrefix: body.messagePrefix || "Cluster",
      discordApplicationId: body.applicationId,
    };
    if (body.clearApplicationPublicKey) changes.discordApplicationPublicKey = "";
    else if (body.applicationPublicKey?.trim()) changes.discordApplicationPublicKey = body.applicationPublicKey.trim();
    if (body.clearBotToken) changes.discordBotToken = "";
    else if (body.botToken?.trim()) changes.discordBotToken = body.botToken.trim();
    if (body.clearWebhook) changes.discordWebhookUrl = "";
    else if (webhook !== undefined) changes.discordWebhookUrl = webhook;
    try {
      await input.saveSettings({}, {
        changedFields: changes,
        expectedSettings: expectedServerConfigFields(input.settingsForClient(existingSettings), changes),
      });
    } catch (error: any) {
      if (error?.code === "SERVER_CONFIG_CONFLICT") {
        return reply.code(409).send({ ok: false, code: error.code, error: error.message, conflictingKeys: error.conflictingKeys });
      }
      throw error;
    }
    const existing = await input.prisma.integrationConnection.findFirst({ where: { workspaceId: workspace.id, providerId: provider.id, archived: false }, orderBy: { createdAt: "asc" } });
    let existingConfiguration: Record<string, unknown> = {};
    try { existingConfiguration = JSON.parse(String(existing?.configuration || "{}")); } catch { /* legacy config */ }
    const connectionData = {
      displayName: body.displayName,
      status: "configured",
      configuration: JSON.stringify({ ...existingConfiguration, configurationOwner: "discord", interactionEndpoint: "/api/integrations/discord/interactions" }),
      secretRefs: JSON.stringify({ botToken: "settings:discordBotToken", webhook: "settings:discordWebhookUrl" }),
      capabilities: JSON.stringify(provider.capabilities),
      healthState: "unknown",
      healthMessage: null,
      lastCheckedAt: null,
    };
    const committedSettings = await input.readSettings(true);
    const connection = existing
      ? await input.prisma.integrationConnection.update({ where: { id: existing.id }, data: connectionData })
      : await input.prisma.integrationConnection.create({ data: { workspaceId: workspace.id, providerId: provider.id, category: provider.category, ...connectionData } });
    return { ok: true, connection: serializeConnection(connection), configuration: { guildId: body.guildId, forumChannelId: body.forumChannelId, chatChannelId: body.chatChannelId, adminRoleId: body.adminRoleId, messagePrefix: body.messagePrefix || "Cluster", applicationId: body.applicationId, applicationPublicKeyConfigured: Boolean(committedSettings.discordApplicationPublicKey), botTokenConfigured: Boolean(committedSettings.discordBotToken), webhookConfigured: Boolean(committedSettings.discordWebhookUrl), interactionEndpoint: "/api/integrations/discord/interactions" } };
  });

  input.app.get("/api/admin/integrations/connections", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "integrations", "view");
    if (!viewer) return;
    const query = z.object({ category: z.enum(CONNECTION_CATEGORIES).optional() }).parse(request.query || {});
    const workspace = await activeWorkspace(input.prisma);
    const rows = await input.prisma.integrationConnection.findMany({
      where: { workspaceId: workspace.id, archived: false, ...(query.category ? { category: query.category } : {}) },
      orderBy: [{ category: "asc" }, { displayName: "asc" }],
    });
    return { ok: true, connections: rows.map(serializeConnection) };
  });

  input.app.post("/api/admin/integrations/connections", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const body = z.object({
      providerId: z.string().trim().min(2).max(80),
      displayName: z.string().trim().min(1).max(120),
      configuration: z.record(z.string(), z.unknown()).optional().default({}),
    }).parse(request.body);
    const provider = input.registry.get(body.providerId);
    if (!provider) throw createHttpError("INTEGRATION_PROVIDER_NOT_FOUND", "Choose a registered integration provider.", 400);
    if (provider.implementation !== "active") throw createHttpError("INTEGRATION_PROVIDER_UNAVAILABLE", "This provider is a reviewed adapter contract and cannot be installed yet.", 409);
    const workspace = await activeWorkspace(input.prisma);
    const row = await input.prisma.integrationConnection.create({
      data: {
        workspaceId: workspace.id,
        providerId: provider.id,
        category: provider.category,
        displayName: body.displayName,
        status: "configured",
        configuration: JSON.stringify(body.configuration),
        capabilities: JSON.stringify(provider.capabilities),
      },
    });
    await recordIntegrationChange("integration_connection", row.id, "integration_connection_created", "Integration connection created", { providerId: row.providerId, category: row.category });
    return reply.code(201).send({ ok: true, connection: serializeConnection(row) });
  });

  input.app.patch("/api/admin/integrations/connections/:connectionId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      displayName: z.string().trim().min(1).max(120).optional(),
      status: z.enum(["configured", "disabled", "error"]).optional(),
      configuration: z.record(z.string(), z.unknown()).optional(),
    }).parse(request.body);
    const existing = await input.prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!existing || existing.archived) throw createHttpError("INTEGRATION_CONNECTION_NOT_FOUND", "Integration connection not found.", 404);
    const row = await input.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        displayName: body.displayName,
        status: body.status,
        configuration: body.configuration === undefined ? undefined : JSON.stringify(body.configuration),
      },
    });
    await recordIntegrationChange("integration_connection", row.id, "integration_connection_updated", "Integration connection updated", { providerId: row.providerId, category: row.category });
    return { ok: true, connection: serializeConnection(row) };
  });

  input.app.delete("/api/admin/integrations/connections/:connectionId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(request.params);
    const existing = await input.prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!existing || existing.archived) throw createHttpError("INTEGRATION_CONNECTION_NOT_FOUND", "Integration connection not found.", 404);
    await input.prisma.$transaction([
      input.prisma.projectIntegrationBinding.updateMany({ where: { connectionId, archived: false }, data: { archived: true } }),
      ...(existing.category === "source-control" ? [input.prisma.sourceRepository.updateMany({ where: { connectionId, archived: false }, data: { connectionId: null, healthState: "warning", healthMessage: "Source Control connection removed." } })] : []),
      input.prisma.integrationConnection.update({ where: { id: connectionId }, data: { archived: true, status: "disabled" } }),
    ]);
    await recordIntegrationChange("integration_connection", connectionId, "integration_connection_removed", "Integration connection removed", { providerId: existing.providerId, category: existing.category });
    return { ok: true };
  });

  input.app.get("/api/admin/source-control/repositories", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "sourceControl", "view");
    if (!viewer) return;
    const workspace = await activeWorkspace(input.prisma);
    const rows = await input.prisma.sourceRepository.findMany({
      where: { workspaceId: workspace.id, archived: false },
      include: { connection: true, projects: { where: { archived: false }, select: { projectId: true, isPrimary: true, project: { select: { id: true, name: true } } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }, _count: { select: { projects: true, branches: true, commits: true, changes: true, operations: true } } },
      orderBy: { name: "asc" },
    });
    return { ok: true, repositories: rows.map(serializeRepository) };
  });

  input.app.post("/api/admin/source-control/repositories", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const body = z.object({
      name: z.string().trim().min(1).max(160),
      connectionId: z.string().optional().nullable(),
      hostingMode: z.enum(["cluster", "remote"]).default("remote"),
      remoteUrl: z.string().url().max(2048).optional().nullable(),
      cloneUrl: z.string().url().max(2048).optional().nullable(),
      defaultBranch: z.string().trim().min(1).max(200).default("main"),
      providerRepositoryId: z.string().trim().max(240).optional().nullable(),
    }).parse(request.body);
    const hostingError = validateRepositoryHosting(body);
    if (hostingError) throw createHttpError("SOURCE_REPOSITORY_HOSTING_INVALID", hostingError, 400);
    const workspace = await activeWorkspace(input.prisma);
    if (body.connectionId) {
      const connection = await input.prisma.integrationConnection.findFirst({ where: { id: body.connectionId, workspaceId: workspace.id, category: "source-control", archived: false, status: { not: "disabled" } } });
      if (!connection) throw createHttpError("SOURCE_CONNECTION_NOT_FOUND", "Choose an active source-control connection.", 400);
    }
    const row = await input.prisma.sourceRepository.create({
      data: {
        workspaceId: workspace.id,
        connectionId: body.connectionId || null,
        name: body.name,
        hostingMode: body.hostingMode,
        remoteUrl: body.remoteUrl || null,
        cloneUrl: body.cloneUrl || body.remoteUrl || null,
        defaultBranch: body.defaultBranch,
        providerRepositoryId: body.providerRepositoryId || null,
      },
      include: { connection: true, _count: { select: { projects: true, branches: true, commits: true, changes: true, operations: true } } },
    });
    await recordIntegrationChange("source_repository", row.id, "source_repository_created", "Source repository created", { connectionId: row.connectionId });
    return reply.code(201).send({ ok: true, repository: serializeRepository(row) });
  });

  input.app.patch("/api/admin/source-control/repositories/:repositoryId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const { repositoryId } = z.object({ repositoryId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      name: z.string().trim().min(1).max(160).optional(),
      connectionId: z.string().optional().nullable(),
      remoteUrl: z.string().url().max(2048).optional().nullable(),
      cloneUrl: z.string().url().max(2048).optional().nullable(),
      defaultBranch: z.string().trim().min(1).max(200).optional(),
      healthState: z.enum(["unknown", "healthy", "warning", "failed"]).optional(),
      healthMessage: z.string().max(1000).optional().nullable(),
    }).parse(request.body);
    const workspace = await activeWorkspace(input.prisma);
    const existing = await input.prisma.sourceRepository.findFirst({ where: { id: repositoryId, workspaceId: workspace.id, archived: false } });
    if (!existing) throw createHttpError("SOURCE_REPOSITORY_NOT_FOUND", "Repository not found.", 404);
    if (body.connectionId) {
      const connection = await input.prisma.integrationConnection.findFirst({ where: { id: body.connectionId, workspaceId: workspace.id, category: "source-control", archived: false, status: { not: "disabled" } } });
      if (!connection) throw createHttpError("SOURCE_CONNECTION_NOT_FOUND", "Choose an active source-control connection.", 400);
    }
    const row = await input.prisma.sourceRepository.update({ where: { id: repositoryId }, data: body, include: { connection: true, _count: { select: { projects: true, branches: true, commits: true, changes: true, operations: true } } } });
    await recordIntegrationChange("source_repository", row.id, "source_repository_updated", "Source repository updated", { connectionId: row.connectionId });
    return { ok: true, repository: serializeRepository(row) };
  });

  input.app.delete("/api/admin/source-control/repositories/:repositoryId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "sourceControl", "manage");
    if (!admin) return;
    const { repositoryId } = z.object({ repositoryId: z.string().min(1) }).parse(request.params);
    const existing = await input.prisma.sourceRepository.findUnique({ where: { id: repositoryId } });
    if (!existing || existing.archived) throw createHttpError("SOURCE_REPOSITORY_NOT_FOUND", "Repository not found.", 404);
    await input.prisma.$transaction([
      input.prisma.projectSourceBinding.updateMany({ where: { repositoryId, archived: false }, data: { archived: true, isPrimary: false } }),
      input.prisma.sourceRepository.update({ where: { id: repositoryId }, data: { archived: true } }),
    ]);
    await recordIntegrationChange("source_repository", repositoryId, "source_repository_removed", "Source repository removed");
    return { ok: true };
  });

  input.app.get("/api/admin/versioning/policies", async (request, reply) => {
    const viewer = await input.authorization.requireTool(request, reply, "builds", "view");
    if (!viewer) return;
    const workspace = await activeWorkspace(input.prisma);
    const rows = await input.prisma.versionPolicy.findMany({ where: { workspaceId: workspace.id, archived: false }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    return { ok: true, presets: VERSION_PRESETS, policies: rows.map(serializeVersionPolicy) };
  });

  input.app.post("/api/admin/versioning/policies", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "builds", "manage");
    if (!admin) return;
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      presetKey: z.enum(VERSION_PRESETS).default("custom"),
      formatTemplate: z.string().trim().min(1).max(240),
      components: z.array(z.record(z.string(), z.unknown())).max(24).optional().default([]),
      orderingRules: z.record(z.string(), z.unknown()).optional().default({}),
      bumpRules: z.record(z.string(), z.unknown()).optional().default({}),
      promotionRules: z.record(z.string(), z.unknown()).optional().default({}),
      projectOverrideAllowed: z.boolean().default(false),
      isDefault: z.boolean().default(false),
    }).parse(request.body);
    const workspace = await activeWorkspace(input.prisma);
    const row = await input.prisma.$transaction(async (tx: any) => {
      if (body.isDefault) await tx.versionPolicy.updateMany({ where: { workspaceId: workspace.id, projectId: null, archived: false }, data: { isDefault: false } });
      return tx.versionPolicy.create({ data: { workspaceId: workspace.id, ...body, components: JSON.stringify(body.components), orderingRules: JSON.stringify(body.orderingRules), bumpRules: JSON.stringify(body.bumpRules), promotionRules: JSON.stringify(body.promotionRules) } });
    });
    return reply.code(201).send({ ok: true, policy: serializeVersionPolicy(row) });
  });

  input.app.patch("/api/admin/versioning/policies/:policyId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "builds", "manage");
    if (!admin) return;
    const { policyId } = z.object({ policyId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      formatTemplate: z.string().trim().min(1).max(240).optional(),
      projectOverrideAllowed: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }).parse(request.body);
    const existing = await input.prisma.versionPolicy.findUnique({ where: { id: policyId } });
    if (!existing || existing.archived) throw createHttpError("VERSION_POLICY_NOT_FOUND", "Version policy not found.", 404);
    const row = await input.prisma.$transaction(async (tx: any) => {
      if (body.isDefault) await tx.versionPolicy.updateMany({ where: { workspaceId: existing.workspaceId, projectId: existing.projectId, archived: false, id: { not: policyId } }, data: { isDefault: false } });
      return tx.versionPolicy.update({ where: { id: policyId }, data: body });
    });
    return { ok: true, policy: serializeVersionPolicy(row) };
  });
}
