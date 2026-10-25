import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { SettingPayload } from "../../app/server-composition-types.js";
import { createHttpError } from "../../core/http-errors.js";

const DISCORD_EVENT_CLASSES = ["review", "source", "build", "qa", "ticket", "milestone", "release", "system", "all"] as const;
const PRIORITY_RANK: Record<string, number> = { normal: 0, medium: 1, high: 2, critical: 3 };
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type DiscordEventClass = (typeof DISCORD_EVENT_CLASSES)[number];

export type DiscordRouteInput = {
  connectionId: string;
  channelId: string;
  displayName?: string | null;
  eventClasses?: DiscordEventClass[];
  minPriority?: "normal" | "medium" | "high" | "critical";
  mentionMode?: "off" | "linked";
  routeKind?: "channel" | "thread";
};

type DiscordProductionServiceInput = {
  prisma: any;
  queue: { enqueue: (input: any) => Promise<any> };
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  discordRequest: (settings: SettingPayload, path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  notificationService: any;
  authorization: any;
  sourceControl?: any;
  logActivity: (input: any) => Promise<void>;
  logger?: { info?: (payload: unknown, message?: string) => void; warn?: (payload: unknown, message?: string) => void };
};

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanText(value: unknown, maximum = 2_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function discordUrl(guildId: string | undefined, channelId: string, messageId?: string | null) {
  if (!guildId || !channelId) return null;
  return `https://discord.com/channels/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}${messageId ? `/${encodeURIComponent(messageId)}` : ""}`;
}

function serializeRoute(binding: any) {
  const metadata = parseObject(binding?.metadata);
  return {
    id: binding.id,
    projectId: binding.projectId,
    connectionId: binding.connectionId,
    channelId: binding.externalId,
    url: binding.externalUrl,
    displayName: binding.displayName,
    eventClasses: parseArray(metadata.eventClasses).map(String),
    minPriority: String(metadata.minPriority || "medium"),
    mentionMode: metadata.mentionMode === "off" ? "off" : "linked",
    routeKind: metadata.routeKind === "thread" ? "thread" : "channel",
    health: String(metadata.health || "unknown"),
    healthMessage: metadata.healthMessage ? String(metadata.healthMessage) : null,
    parentId: metadata.parentId ? String(metadata.parentId) : null,
    discordType: Number.isFinite(Number(metadata.discordType)) ? Number(metadata.discordType) : null,
    lastCheckedAt: metadata.lastCheckedAt ? String(metadata.lastCheckedAt) : null,
    archived: Boolean(binding.archived),
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function eventClassForNotification(item: any): DiscordEventClass {
  const text = `${item?.tool || ""} ${item?.signal || ""} ${item?.entityType || ""} ${item?.title || ""} ${item?.message || ""}`.toLowerCase();
  if (/source review|review requested|approval|changes requested/.test(text)) return "review";
  if (/source_control|source control|commit|branch|merge|repository|git/.test(text)) return "source";
  if (/build|artifact|deployment/.test(text)) return "build";
  if (/\bqa\b|test plan|test session|regression/.test(text)) return "qa";
  if (/ticket|assignment|assignee/.test(text)) return "ticket";
  if (/milestone|timeline|due date|deadline/.test(text)) return "milestone";
  if (/release|published|version/.test(text)) return "release";
  return "system";
}

const DISCORD_EVENT_LABELS: Record<DiscordEventClass, string> = {
  review: "Review",
  source: "Source Control",
  build: "Build",
  qa: "QA",
  ticket: "Ticket",
  milestone: "Milestone",
  release: "Release",
  system: "System",
  all: "Update",
};

function humanPriority(value: unknown) {
  const priority = cleanText(value || "normal", 40).toLowerCase();
  if (priority === "critical") return "Critical";
  if (priority === "high") return "High";
  if (priority === "medium") return "Medium";
  return "Normal";
}

function discordNotificationPresentation(item: any, eventClass = eventClassForNotification(item)) {
  const label = DISCORD_EVENT_LABELS[eventClass] || "Update";
  const title = cleanText(item?.title || `${label} update`, 250) || `${label} update`;
  const description = cleanText(item?.message, 4_000) || undefined;
  const fields = [
    item?.projectLabel ? { name: "Project", value: cleanText(item.projectLabel, 1_000), inline: true } : null,
    { name: "Update", value: label, inline: true },
    { name: "Priority", value: humanPriority(item?.priority), inline: true },
    item?.requiresAction ? { name: "Action", value: "Action required in Cluster", inline: false } : null,
  ].filter(Boolean);
  return { title, description, fields };
}

function routeMatches(binding: any, item: any) {
  const metadata = parseObject(binding.metadata);
  const classes = parseArray(metadata.eventClasses).map((value) => String(value).toLowerCase());
  const eventClass = eventClassForNotification(item);
  if (classes.length && !classes.includes("all") && !classes.includes(eventClass)) return false;
  const minimum = String(metadata.minPriority || "medium");
  return (PRIORITY_RANK[String(item.priority || "normal")] ?? 0) >= (PRIORITY_RANK[minimum] ?? 1);
}

function discordMentionPolicy(user: any, item: any) {
  const preferences = parseObject(user?.preferences);
  const mode = String(preferences.notificationDiscordDelivery || "action-required");
  if (mode === "off") return false;
  if (mode === "all") return true;
  if (mode === "mentions") return item.signal === "mention";
  return Boolean(item.requiresAction || ["mention", "assignment", "review", "approval", "blocked", "failure"].includes(String(item.signal || "")));
}

function notificationDeepLink(settings: SettingPayload, item: any) {
  const root = cleanText(settings.publicWebUrl, 2_000).replace(/\/$/, "");
  if (!root) return null;
  const projectId = cleanText(item.projectId || item.resourceProjectId, 240);
  if (projectId) return `${root}/#project/${encodeURIComponent(projectId)}`;
  return `${root}/#notifications`;
}

function interactionResponse(content: string) {
  return { type: 4, data: { content: cleanText(content, 1_900), flags: 64, allowed_mentions: { parse: [] } } };
}

function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, body: Buffer) {
  if (!/^[a-f0-9]{64}$/i.test(publicKeyHex) || !/^[a-f0-9]{128}$/i.test(signatureHex) || !timestamp) return false;
  const timestampMs = Number(timestamp) * 1_000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verifySignature(null, Buffer.concat([Buffer.from(timestamp, "utf8"), body]), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export function createDiscordProductionService(input: DiscordProductionServiceInput) {
  async function activeConnection(connectionId?: string | null) {
    const connection = connectionId
      ? await input.prisma.integrationConnection.findFirst({ where: { id: connectionId, providerId: "communication.discord", archived: false, status: { not: "disabled" } }, include: { workspace: true } })
      : await input.prisma.integrationConnection.findFirst({ where: { providerId: "communication.discord", archived: false, status: { not: "disabled" } }, include: { workspace: true }, orderBy: { createdAt: "asc" } });
    if (!connection) throw createHttpError("DISCORD_CONNECTION_NOT_FOUND", "An active Discord connection is required.", 409);
    return connection;
  }

  async function projectRoutes(projectId: string) {
    const rows = await input.prisma.projectIntegrationBinding.findMany({
      where: { projectId, resourceType: "discord_route", archived: false, connection: { providerId: "communication.discord", archived: false } },
      include: { connection: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(serializeRoute);
  }

  async function upsertProjectRoute(projectId: string, routeId: string | null, route: DiscordRouteInput) {
    const project = await input.prisma.project.findFirst({ where: { id: projectId, archived: false } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const connection = await input.prisma.integrationConnection.findFirst({ where: { id: route.connectionId, workspaceId: project.workspaceId, providerId: "communication.discord", archived: false, status: { not: "disabled" } } });
    if (!connection) throw createHttpError("DISCORD_CONNECTION_NOT_FOUND", "Choose the Discord connection linked to this studio.", 400);
    const linked = await input.prisma.projectIntegrationBinding.findFirst({ where: { projectId, connectionId: connection.id, resourceType: "project", archived: false } });
    if (!linked) throw createHttpError("DISCORD_PROJECT_NOT_LINKED", "Link this Discord connection to the project before adding delivery routes.", 409);
    const channelId = cleanText(route.channelId, 120);
    if (!/^\d{8,24}$/.test(channelId)) throw createHttpError("DISCORD_CHANNEL_INVALID", "Choose a valid Discord channel or thread.", 400);
    const eventClasses = Array.from(new Set((route.eventClasses?.length ? route.eventClasses : ["all"]).filter((item): item is DiscordEventClass => DISCORD_EVENT_CLASSES.includes(item as DiscordEventClass))));
    const metadata = JSON.stringify({ eventClasses, minPriority: route.minPriority || "medium", mentionMode: route.mentionMode || "linked", routeKind: route.routeKind || "channel", health: "unknown", healthMessage: "Not checked yet.", lastCheckedAt: null });
    const url = discordUrl((await input.readSettings()).discordGuildId, channelId);
    if (routeId) {
      const existing = await input.prisma.projectIntegrationBinding.findFirst({ where: { id: routeId, projectId, resourceType: "discord_route", archived: false } });
      if (!existing) throw createHttpError("DISCORD_ROUTE_NOT_FOUND", "Discord route not found.", 404);
      const duplicate = await input.prisma.projectIntegrationBinding.findFirst({ where: { projectId, connectionId: connection.id, resourceType: "discord_route", externalId: channelId, archived: false, id: { not: existing.id } } });
      if (duplicate) throw createHttpError("DISCORD_ROUTE_DUPLICATE", "That channel already has a project delivery route.", 409);
      const updated = await input.prisma.projectIntegrationBinding.update({ where: { id: existing.id }, data: { connectionId: connection.id, externalId: channelId, externalUrl: url, displayName: cleanText(route.displayName, 160) || existing.displayName || `Discord ${channelId}`, metadata } });
      return serializeRoute(updated);
    }
    const existing = await input.prisma.projectIntegrationBinding.findFirst({ where: { projectId, connectionId: connection.id, resourceType: "discord_route", externalId: channelId } });
    const row = existing
      ? await input.prisma.projectIntegrationBinding.update({ where: { id: existing.id }, data: { archived: false, externalUrl: url, displayName: cleanText(route.displayName, 160) || existing.displayName || `Discord ${channelId}`, metadata } })
      : await input.prisma.projectIntegrationBinding.create({ data: { projectId, connectionId: connection.id, resourceType: "discord_route", externalId: channelId, externalUrl: url, displayName: cleanText(route.displayName, 160) || `Discord ${channelId}`, metadata, isPrimary: false } });
    return serializeRoute(row);
  }

  async function archiveProjectRoute(projectId: string, routeId: string) {
    const existing = await input.prisma.projectIntegrationBinding.findFirst({ where: { id: routeId, projectId, resourceType: "discord_route", archived: false } });
    if (!existing) throw createHttpError("DISCORD_ROUTE_NOT_FOUND", "Discord route not found.", 404);
    await input.prisma.projectIntegrationBinding.update({ where: { id: existing.id }, data: { archived: true } });
    return { id: existing.id, archived: true };
  }

  async function discordChannels(settings: SettingPayload) {
    if (!settings.discordGuildId || !settings.discordBotToken) return [];
    const [channels, threads] = await Promise.all([
      input.discordRequest(settings, `/guilds/${settings.discordGuildId}/channels`).catch(() => []),
      input.discordRequest(settings, `/guilds/${settings.discordGuildId}/threads/active`).then((value) => value?.threads || []).catch(() => []),
    ]);
    const map = new Map<string, any>();
    for (const channel of [...(Array.isArray(channels) ? channels : []), ...(Array.isArray(threads) ? threads : [])]) {
      if (!channel?.id) continue;
      map.set(String(channel.id), channel);
    }
    return [...map.values()];
  }

  async function availableChannels(projectId: string) {
    const project = await input.prisma.project.findFirst({ where: { id: projectId, archived: false } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const binding = await input.prisma.projectIntegrationBinding.findFirst({ where: { projectId, resourceType: "project", archived: false, connection: { providerId: "communication.discord", archived: false, status: { not: "disabled" } } }, include: { connection: true } });
    if (!binding) return { connectionId: null, channels: [] };
    const settings = await input.readSettings();
    const channels = await discordChannels(settings);
    return { connectionId: binding.connectionId, channels: channels.map((channel: any) => ({ id: String(channel.id), name: cleanText(channel.name, 160) || `Discord ${channel.id}`, parentId: channel.parent_id ? String(channel.parent_id) : null, type: Number(channel.type), routeKind: [10, 11, 12].includes(Number(channel.type)) ? "thread" : "channel", url: discordUrl(settings.discordGuildId, String(channel.id)) })).sort((a: any, b: any) => a.name.localeCompare(b.name)) };
  }

  async function reconcileRoutes(options: { projectId?: string | null; connectionId?: string | null } = {}) {
    const settings = await input.readSettings(true);
    const connection = await activeConnection(options.connectionId);
    const channels = await discordChannels(settings);
    const byId = new Map(channels.map((channel: any) => [String(channel.id), channel]));
    const rows = await input.prisma.projectIntegrationBinding.findMany({ where: { connectionId: connection.id, resourceType: "discord_route", archived: false, ...(options.projectId ? { projectId: options.projectId } : {}) }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    let healthy = 0;
    let missing = 0;
    let renamed = 0;
    let archived = 0;
    for (const row of rows) {
      if (row.project?.archived) {
        archived += 1;
        await input.prisma.projectIntegrationBinding.update({ where: { id: row.id }, data: { archived: true } });
        continue;
      }
      const channel = byId.get(String(row.externalId || ""));
      const previous = parseObject(row.metadata);
      const now = new Date().toISOString();
      if (!channel) {
        missing += 1;
        await input.prisma.projectIntegrationBinding.update({ where: { id: row.id }, data: { metadata: JSON.stringify({ ...previous, health: "missing", healthMessage: "Discord channel or thread no longer exists or is not visible to the bot.", lastCheckedAt: now }) } });
        continue;
      }
      healthy += 1;
      const name = cleanText(channel.name, 160) || row.displayName || `Discord ${row.externalId}`;
      if (row.displayName && row.displayName !== name) renamed += 1;
      const url = discordUrl(settings.discordGuildId, String(channel.id));
      const metadata = { ...previous, health: "healthy", healthMessage: "Discord route verified.", lastCheckedAt: now, parentId: channel.parent_id || null, discordType: Number(channel.type), routeKind: [10, 11, 12].includes(Number(channel.type)) ? "thread" : "channel" };
      await input.prisma.$transaction([
        input.prisma.projectIntegrationBinding.update({ where: { id: row.id }, data: { displayName: name, externalUrl: url, metadata: JSON.stringify(metadata) } }),
        input.prisma.externalEntityLink.upsert({
          where: { workspaceId_entityType_entityId_providerEntityType_providerEntityId: { workspaceId: row.project.workspaceId, entityType: "project_integration_binding", entityId: row.id, providerEntityType: "discord_channel", providerEntityId: String(channel.id) } },
          create: { workspaceId: row.project.workspaceId, projectId: row.projectId, connectionId: row.connectionId, entityType: "project_integration_binding", entityId: row.id, providerEntityType: "discord_channel", providerEntityId: String(channel.id), providerUrl: url, metadata: JSON.stringify({ name, type: Number(channel.type), parentId: channel.parent_id || null }) },
          update: { projectId: row.projectId, connectionId: row.connectionId, providerUrl: url, metadata: JSON.stringify({ name, type: Number(channel.type), parentId: channel.parent_id || null }) },
        }),
      ]);
    }
    const healthState = missing ? (healthy ? "degraded" : "failed") : "healthy";
    const activeChecked = Math.max(0, rows.length - archived);
    const message = activeChecked ? `${healthy}/${activeChecked} Discord project routes checked${missing ? ` · ${missing} need attention` : ""}${archived ? ` · ${archived} archived with inactive projects` : ""}.` : archived ? `${archived} Discord route${archived === 1 ? "" : "s"} archived with inactive projects.` : "No project Discord routes are configured.";
    await input.prisma.integrationConnection.update({ where: { id: connection.id }, data: { healthState, healthMessage: message, lastCheckedAt: new Date() } }).catch(() => undefined);
    return { checked: activeChecked, healthy, missing, renamed, archived, healthState, message };
  }

  async function deliverySummary(connectionId?: string | null) {
    const connection = await activeConnection(connectionId);
    const [routeCount, projectCount, completed, failed, pending, running, deadLetter, retrying, recentFailures] = await Promise.all([
      input.prisma.projectIntegrationBinding.count({ where: { connectionId: connection.id, resourceType: "discord_route", archived: false } }),
      input.prisma.projectIntegrationBinding.count({ where: { connectionId: connection.id, resourceType: "project", archived: false } }),
      input.prisma.integrationActionReceipt.count({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "completed" } }),
      input.prisma.integrationActionReceipt.count({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "failed" } }),
      input.prisma.integrationActionReceipt.count({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "pending" } }),
      input.prisma.integrationActionReceipt.count({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "running" } }),
      input.prisma.integrationActionReceipt.count({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "failed", attempts: { gte: 5 } } }),
      input.prisma.integrationActionReceipt.count({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "failed", attempts: { lt: 5 } } }),
      input.prisma.integrationActionReceipt.findMany({ where: { connectionId: connection.id, actionType: "discord.notification.send", status: "failed" }, orderBy: { updatedAt: "desc" }, take: 10 }),
    ]);
    return {
      connectionId: connection.id,
      projectCount,
      routeCount,
      deliveries: { completed, failed, pending, running, retrying, deadLetter },
      recentFailures: recentFailures.map((receipt: any) => {
        const metadata = parseObject(receipt.responseMetadata);
        return { id: receipt.id, notificationId: metadata.notificationId || receipt.entityId || null, projectId: metadata.projectId || null, channelId: metadata.channelId || null, attempts: receipt.attempts, deadLetter: Number(receipt.attempts || 0) >= 5, manualRetryAvailable: true, error: cleanText(receipt.lastError || "Discord delivery failed.", 500), updatedAt: receipt.updatedAt };
      }),
      healthState: connection.healthState,
      healthMessage: connection.healthMessage,
      lastCheckedAt: connection.lastCheckedAt,
    };
  }

  async function retryDelivery(receiptId: string) {
    const receipt = await input.prisma.integrationActionReceipt.findUnique({ where: { id: receiptId }, include: { connection: true } });
    if (!receipt || receipt.actionType !== "discord.notification.send") throw createHttpError("DISCORD_DELIVERY_NOT_FOUND", "Discord delivery receipt not found.", 404);
    if (receipt.status !== "failed") throw createHttpError("DISCORD_DELIVERY_NOT_FAILED", "Only failed Discord deliveries can be retried.", 409);
    const metadata = parseObject(receipt.responseMetadata);
    const item = metadata.notificationId ? await input.prisma.notificationInboxItem.findUnique({ where: { id: metadata.notificationId } }) : null;
    if (!item) throw createHttpError("DISCORD_NOTIFICATION_NOT_FOUND", "The Inbox item for this delivery no longer exists.", 409);
    const channelId = cleanText(metadata.channelId, 120);
    if (!channelId) throw createHttpError("DISCORD_ROUTE_INVALID", "The failed delivery has no Discord destination.", 409);
    const routeId = cleanText(metadata.routeId, 200);
    if (routeId && !["studio-default", "project-default"].includes(routeId)) {
      const route = await input.prisma.projectIntegrationBinding.findFirst({ where: { id: routeId, connectionId: receipt.connectionId, resourceType: "discord_route", archived: false, project: { archived: false } } });
      if (!route) throw createHttpError("DISCORD_ROUTE_NOT_FOUND", "The Discord route for this delivery is no longer active.", 409);
    }
    await input.prisma.integrationActionReceipt.update({ where: { id: receipt.id }, data: { status: "pending", lastError: null, completedAt: null } });
    const retryNumber = Math.max(1, Number(receipt.attempts || 0) + 1);
    await input.queue.enqueue({ type: "integration.discord-delivery", queue: "integrations", workspaceId: receipt.connection.workspaceId, payload: { receiptId: receipt.id }, maxAttempts: 5, dedupeKey: `${receipt.actionKey}:manual:${retryNumber}`.slice(0, 200), priority: item.priority === "critical" ? 50 : item.priority === "high" ? 25 : 5, costUnits: 1 });
    return { receiptId: receipt.id, status: "pending" };
  }

  async function mentionUsersForEvent(item: any) {
    if (!item.activityEventId) return [];
    const rows = await input.prisma.notificationInboxItem.findMany({ where: { activityEventId: item.activityEventId, dismissedAt: null }, include: { user: { select: { id: true, discordUserId: true, preferences: true } } }, take: 500 });
    return rows.filter((row: any) => row.user?.discordUserId && discordMentionPolicy(row.user, row)).map((row: any) => String(row.user.discordUserId));
  }

  async function routesForNotification(item: any, currentSettings?: SettingPayload) {
    const settings = currentSettings ?? await input.readSettings();
    if (!item.projectId) {
      const meta = parseObject(item.metadata);
      if (meta.discordDeliveryRequested !== true || !settings.discordChatChannelId) return [];
      const connection = await activeConnection();
      return [{ id: "studio-default", projectId: null, connectionId: connection.id, externalId: settings.discordChatChannelId, externalUrl: discordUrl(settings.discordGuildId, settings.discordChatChannelId), displayName: "Studio default", metadata: JSON.stringify({ eventClasses: ["all"], minPriority: "normal", mentionMode: "linked", health: "unknown" }) }];
    }
    const bindings = await input.prisma.projectIntegrationBinding.findMany({ where: { projectId: item.projectId, resourceType: "discord_route", archived: false, project: { archived: false }, connection: { providerId: "communication.discord", archived: false, status: { not: "disabled" } } }, include: { connection: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
    const matched = bindings.filter((binding: any) => routeMatches(binding, item));
    if (matched.length) return matched;
    const projectBinding = await input.prisma.projectIntegrationBinding.findFirst({ where: { projectId: item.projectId, resourceType: "project", archived: false, project: { archived: false }, connection: { providerId: "communication.discord", archived: false, status: { not: "disabled" } } }, include: { connection: true } });
    if (!projectBinding || !settings.discordChatChannelId) return [];
    return [{ id: "project-default", projectId: item.projectId, connectionId: projectBinding.connectionId, externalId: settings.discordChatChannelId, externalUrl: discordUrl(settings.discordGuildId, settings.discordChatChannelId), displayName: "Project default", metadata: JSON.stringify({ eventClasses: ["all"], minPriority: "medium", mentionMode: "linked", health: "unknown" }) }];
  }

  async function enqueueNotification(item: any) {
    if (!item?.id) return { queued: 0 };
    const routes = await routesForNotification(item);
    let queued = 0;
    for (const route of routes) {
      const connection = await activeConnection(route.connectionId);
      const channelId = cleanText(route.externalId, 120);
      if (!channelId) continue;
      const eventKey = cleanText(item.activityEventId || item.id, 240);
      const actionKey = `discord-delivery:${eventKey}:${channelId}`.slice(0, 200);
      const existing = await input.prisma.integrationActionReceipt.findUnique({ where: { connectionId_actionKey: { connectionId: connection.id, actionKey } } });
      if (existing?.status === "completed" || existing?.status === "running" || existing?.status === "pending") continue;
      const receipt = existing
        ? await input.prisma.integrationActionReceipt.update({ where: { id: existing.id }, data: { status: "pending", attempts: 0, lastError: null, completedAt: null, responseMetadata: JSON.stringify({ notificationId: item.id, activityEventId: item.activityEventId || null, projectId: item.projectId || null, routeId: route.id, channelId, mentionMode: parseObject(route.metadata).mentionMode === "off" ? "off" : "linked" }) } })
        : await input.prisma.integrationActionReceipt.create({ data: { connectionId: connection.id, actionKey, actionType: "discord.notification.send", entityType: "notification", entityId: item.id, status: "pending", responseMetadata: JSON.stringify({ notificationId: item.id, activityEventId: item.activityEventId || null, projectId: item.projectId || null, routeId: route.id, channelId, mentionMode: parseObject(route.metadata).mentionMode === "off" ? "off" : "linked" }) } });
      await input.queue.enqueue({ type: "integration.discord-delivery", queue: "integrations", workspaceId: connection.workspaceId, payload: { receiptId: receipt.id }, maxAttempts: 5, dedupeKey: actionKey, priority: item.priority === "critical" ? 50 : item.priority === "high" ? 25 : 5, costUnits: 1 });
      queued += 1;
    }
    return { queued };
  }

  /** Requeue orphaned durable receipts after an interrupted enqueue or
   * worker restart. The background queue uses the same dedupeKey, so this
   * will not create duplicate active delivery jobs. Never resend completed,
   * running or terminal receipts just because a reconciliation was requested.
   */
  async function repairPendingDeliveries(limit = 100, now = new Date()) {
    const bound = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
    const staleBefore = new Date(now.getTime() - 2 * 60_000);
    const receipts = await input.prisma.integrationActionReceipt.findMany({
      where: { actionType: "discord.notification.send", status: "pending", updatedAt: { lt: staleBefore } },
      include: { connection: true }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: bound,
    });
    let requeued = 0;
    let skipped = 0;
    for (const receipt of receipts) {
      const metadata = parseObject(receipt.responseMetadata);
      if (!receipt.connection || receipt.connection.archived || receipt.connection.status === "disabled"
        || !metadata.notificationId || !metadata.channelId || !String(receipt.actionKey || "").startsWith("discord-delivery:")) { skipped++; continue; }
      const item = await input.prisma.notificationInboxItem.findUnique({ where: { id: String(metadata.notificationId) }, select: { id: true, priority: true } });
      if (!item) { skipped++; continue; }
      // Explicit project delivery routes may have been archived in the meantime.
      if (metadata.routeId && !["studio-default", "project-default"].includes(String(metadata.routeId))) {
        const route = await input.prisma.projectIntegrationBinding.findUnique({
          where: { id: String(metadata.routeId) }, select: { archived: true, connectionId: true, project: { select: { archived: true } } },
        });
        if (!route || route.archived || route.project?.archived || route.connectionId !== receipt.connectionId) { skipped++; continue; }
      }
      await input.queue.enqueue({ type: "integration.discord-delivery", queue: "integrations",
        workspaceId: receipt.connection.workspaceId, payload: { receiptId: receipt.id }, maxAttempts: 5,
        dedupeKey: receipt.actionKey, priority: item.priority === "critical" ? 50 : item.priority === "high" ? 25 : 5, costUnits: 1 });
      requeued++;
    }
    return { scanned: receipts.length, requeued, skipped };
  }

  /** Queued receipts record their original destination, not permission to send later.
   * This check uses current DB/provider policy, and must run immediately before
   * the external request. A route may be disabled, moved, replaced, filtered or
   * rebound after the original queue transaction. Never redirect that stale
   * work to the newly selected fallback route or a different Project.
   * It remains impossible to recall a request already sent to Discord.
   */
  async function authorizedDeliveryRoute(receipt: any, item: any, metadata: Record<string, any>, settings: SettingPayload) {
    const routeId = cleanText(metadata.routeId, 200);
    const channelId = cleanText(metadata.channelId, 120);
    if (!routeId || !channelId || !receipt.connectionId || !receipt.connection) {
      throw createHttpError("DISCORD_DELIVERY_TARGET_STALE", "Queued Discord delivery has no verified destination.", 409);
    }
    if (String(metadata.notificationId || "") !== String(item.id || "") ||
        String(metadata.projectId || "") !== String(item.projectId || "") ||
        String(receipt.entityId || "") !== String(item.id || "")) {
      throw createHttpError("DISCORD_DELIVERY_SCOPE_CHANGED", "The queued Discord delivery no longer matches its notification scope.", 409);
    }
    // Check against database truth even if the receipt included a previously
    // active connection. A disabled/archived/replaced connection is not an
    // acceptable outbound destination merely because its receipt survived.
    const connection = await activeConnection(String(receipt.connectionId));
    if (String(connection.workspaceId) !== String(receipt.connection.workspaceId || "")) {
      throw createHttpError("DISCORD_DELIVERY_SCOPE_CHANGED", "Discord connection ownership changed.", 409);
    }
    // Routes are subordinate to an active Project/connection association.
    // Archiving a Project binding must revoke deliveries on ALL its routes,
    // including routes that remain independently unarchived.
    if (item.projectId) {
      const binding = await input.prisma.projectIntegrationBinding.findFirst({
        where: { projectId: item.projectId, connectionId: connection.id, resourceType: "project", archived: false,
          project: { archived: false, workspaceId: connection.workspaceId },
          connection: { providerId: "communication.discord", archived: false, status: { not: "disabled" } } },
        select: { id: true },
      });
      if (!binding) throw createHttpError("DISCORD_PROJECT_LINK_REVOKED", "The Project is no longer linked to this Discord connection.", 409);
    }
    const routes = await routesForNotification(item, settings);
    const matching = routes.find((route: any) => String(route.id) === routeId &&
      String(route.connectionId) === String(connection.id) &&
      cleanText(route.externalId, 120) === channelId &&
      String(route.projectId || "") === String(item.projectId || ""));
    if (!matching) {
      throw createHttpError("DISCORD_DELIVERY_TARGET_STALE", "The Discord route or delivery policy changed after this notification was queued.", 409);
    }
    return { channelId, mentionMode: parseObject(matching.metadata).mentionMode === "off" ? "off" : "linked" };
  }

  async function executeDelivery(receiptId: string, attempt: number) {
    const receipt = await input.prisma.integrationActionReceipt.findUnique({ where: { id: receiptId }, include: { connection: true } });
    if (!receipt || receipt.actionType !== "discord.notification.send") throw createHttpError("DISCORD_DELIVERY_NOT_FOUND", "Discord delivery receipt not found.", 404);
    if (receipt.status === "completed") return parseObject(receipt.responseMetadata);
    const metadata = parseObject(receipt.responseMetadata);
    const item = await input.prisma.notificationInboxItem.findUnique({ where: { id: metadata.notificationId } });
    if (!item) throw createHttpError("DISCORD_NOTIFICATION_NOT_FOUND", "The canonical Inbox item for this delivery no longer exists.", 404);
    const settings = await input.readSettings(true);
    // Admission before changing receipt state prevents revoked destinations
    // from being marked running. A second check occurs after async payload
    // construction, adjacent to the external request itself.
    await authorizedDeliveryRoute(receipt, item, metadata, settings);
    await input.prisma.integrationActionReceipt.update({ where: { id: receipt.id }, data: { status: "running", attempts: attempt, lastError: null, completedAt: null } });
    try {
      const mentions = await mentionUsersForEvent(item);
      const deepLink = notificationDeepLink(settings, item);
      const eventClass = eventClassForNotification(item);
      const buttons: any[] = [];
      if (deepLink) buttons.push({ type: 2, style: 5, label: "Open in Cluster", url: deepLink });
      if (item.activityEventId) buttons.push({ type: 2, style: 2, label: "Acknowledge", custom_id: `cl:ack:${item.activityEventId}`.slice(0, 100) });
      const titleText = String(item.title || "");
      if (/source review (opened|ready)/i.test(titleText) && item.entityId && item.projectId) buttons.push({ type: 2, style: 3, label: "Approve review", custom_id: `cl:review:approve:${item.projectId}:${item.entityId}`.slice(0, 100) });
      const presentation = discordNotificationPresentation(item, eventClass);
      const payload = {
        content: mentions.length ? mentions.map((id: string) => `<@${id}>`).join(" ") : undefined,
        embeds: [{
          title: presentation.title,
          description: presentation.description,
          fields: presentation.fields,
          timestamp: new Date(item.createdAt || Date.now()).toISOString(),
        }],
        components: buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : undefined,
        allowed_mentions: { parse: [], users: mentions.slice(0, 100) },
      };
      // Re-read mutable policy after mentions/presentation preparation. Do not
      // reuse the earlier settings snapshot when an administrator has revoked
      // or redirected outbound delivery in the meantime.
      const sendSettings = await input.readSettings(true);
      const { channelId, mentionMode } = await authorizedDeliveryRoute(receipt, item, metadata, sendSettings);
      if (mentionMode === "off") {
        payload.content = undefined;
        payload.allowed_mentions.users = [];
      }
      const sent = await input.discordRequest(sendSettings, `/channels/${channelId}/messages`, { method: "POST", body: payload });
      const messageId = cleanText(sent?.id, 120);
      const providerUrl = discordUrl(sendSettings.discordGuildId, channelId, messageId);
      const completed = { ...metadata, messageId, providerUrl, deliveredAt: new Date().toISOString(), eventClass };
      await input.prisma.$transaction([
        input.prisma.integrationActionReceipt.update({ where: { id: receipt.id }, data: { status: "completed", providerEntityId: messageId || null, providerUrl, responseMetadata: JSON.stringify(completed), completedAt: new Date(), lastError: null } }),
        ...(messageId && item.projectId ? [input.prisma.externalEntityLink.upsert({
          where: { workspaceId_entityType_entityId_providerEntityType_providerEntityId: { workspaceId: receipt.connection.workspaceId, entityType: "notification_event", entityId: String(item.activityEventId || item.id), providerEntityType: "discord_message", providerEntityId: messageId } },
          create: { workspaceId: receipt.connection.workspaceId, projectId: item.projectId, connectionId: receipt.connectionId, entityType: "notification_event", entityId: String(item.activityEventId || item.id), providerEntityType: "discord_message", providerEntityId: messageId, providerUrl, metadata: JSON.stringify({ channelId, notificationId: item.id, eventClass }) },
          update: { projectId: item.projectId, connectionId: receipt.connectionId, providerUrl, metadata: JSON.stringify({ channelId, notificationId: item.id, eventClass }) },
        })] : []),
      ]);
      return completed;
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error, 1_000) || "Discord delivery failed.";
      await input.prisma.integrationActionReceipt.update({ where: { id: receipt.id }, data: { status: "failed", attempts: attempt, lastError: message, completedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
  }

  async function authorizeDiscordUser(discordUserId: string, project: any, tool: string, minimum: "view" | "contribute" | "manage") {
    const user = await input.prisma.user.findFirst({ where: { discordUserId, archived: false, accountState: { not: "PRIVACY_ERASED" } } });
    if (!user) throw createHttpError("DISCORD_IDENTITY_NOT_LINKED", "Link your Discord identity to Cluster before using this action.", 403);
    const accessExpired = Boolean(user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() <= Date.now());
    if (user.accountState !== "ACTIVE" || accessExpired) {
      throw createHttpError("DISCORD_IDENTITY_INACTIVE", "Your linked Cluster account is not currently active for Discord actions.", 403);
    }
    const membership = await input.prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: user.id } });
    const role = membership?.role || "member";
    const rules = await input.prisma.accessRule.findMany({ where: { status: "active", OR: [{ targetKind: "project", targetId: project.id }] } }).catch(() => []);
    const toolMinimum = minimum === "view" ? "view" : minimum === "manage" ? "manage" : "edit";
    const allowed = input.authorization.hasToolPermission(user, role, tool, toolMinimum) && input.authorization.hasTargetAccess(user, role, "project", project.id, project, rules, minimum);
    if (!allowed) throw createHttpError("DISCORD_ACTION_ACCESS_DENIED", "Your Cluster account does not have permission for this action.", 403);
    return { user, role };
  }

  async function ensureTicketBoard(project: any) {
    // Discord intake uses an explicitly named existing Ticket inbox. A channel
    // interaction cannot create a Project Board or populate a user-cleared List.
    const candidates = await input.prisma.board.findMany({
      where: { projectId: project.id, name: "Project tickets", archived: false },
      include: { lists: { orderBy: { position: "asc" } } },
      take: 2,
    });
    if (candidates.length !== 1) throw createHttpError("DISCORD_TICKET_DESTINATION_REQUIRED", "Configure exactly one active 'Project tickets' Board with an active 'New' List before creating Tickets from Discord.", 409);
    const board = candidates[0];
    if (!board.lists.some((list: any) => list.title === "New" && !list.archived && !list.isDone)) {
      throw createHttpError("DISCORD_TICKET_LIST_REQUIRED", "The configured Project tickets Board needs an active 'New' List for Discord intake.", 409);
    }
    return board;
  }

  async function projectRouteForChannel(connectionId: string, channelId: string, settings: SettingPayload) {
    let binding = await input.prisma.projectIntegrationBinding.findFirst({ where: { connectionId, resourceType: "discord_route", externalId: channelId, archived: false, project: { archived: false } }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    if (binding) return binding;
    try {
      const channel = await input.discordRequest(settings, `/channels/${channelId}`);
      if (channel?.parent_id) binding = await input.prisma.projectIntegrationBinding.findFirst({ where: { connectionId, resourceType: "discord_route", externalId: String(channel.parent_id), archived: false, project: { archived: false } }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    } catch {}
    return binding;
  }

  async function createTicketFromInteraction(connection: any, interaction: any, actorDiscordId: string) {
    const settings = await input.readSettings();
    const channelId = cleanText(interaction.channel_id, 120);
    const binding = await projectRouteForChannel(connection.id, channelId, settings);
    if (!binding?.project) throw createHttpError("DISCORD_PROJECT_ROUTE_REQUIRED", "This Discord channel is not routed to a Cluster project.", 409);
    const { user, role } = await authorizeDiscordUser(actorDiscordId, binding.project, "tickets", "contribute");
    const targetId = cleanText(interaction?.data?.target_id, 120);
    const resolved = interaction?.data?.resolved?.messages || {};
    const message = resolved[targetId];
    if (!targetId || !message) throw createHttpError("DISCORD_MESSAGE_REQUIRED", "The selected Discord message is unavailable.", 400);
    const existingLink = await input.prisma.externalEntityLink.findFirst({ where: { workspaceId: binding.project.workspaceId, providerEntityType: "discord_message", providerEntityId: targetId, entityType: "ticket" } });
    if (existingLink) {
      const existing = await input.prisma.card.findUnique({ where: { id: existingLink.entityId } });
      return { ticket: existing, existing: true };
    }
    const board = await ensureTicketBoard(binding.project);
    const boardRules = await input.prisma.accessRule.findMany({ where: { status: "active", OR: [
      { targetKind: "project", targetId: binding.project.id },
      { targetKind: "board", targetId: board.id },
    ] } });
    if (!input.authorization.hasTargetAccess(user, role, "board", board.id, binding.project, boardRules, "contribute")) {
      throw createHttpError("DISCORD_TICKET_BOARD_DENIED", "Your linked Cluster account cannot contribute to that Ticket Board.", 403);
    }
    const list = board.lists.find((row: any) => row.title === "New" && !row.archived && !row.isDone)!;
    const last = await input.prisma.card.findFirst({ where: { listId: list.id, archived: false }, orderBy: { position: "desc" } });
    const author = message.author?.global_name || message.author?.username || "Discord user";
    const content = cleanText(message.content || "Discord message", 8_000) || "Discord message";
    const title = cleanText(content.replace(/\s+/g, " "), 120) || "Discord follow-up";
    const providerUrl = discordUrl(settings.discordGuildId, channelId, targetId);
    const card = await input.prisma.card.create({ data: { listId: list.id, title, workItemKind: "ticket", ticketStage: "new", description: `${content}\n\nDiscord author: ${cleanText(author, 160)}`, priority: "medium", labels: JSON.stringify(["ticket", "discord"]), assigneeId: user.id, position: last ? last.position + 1 : 0, externalUrl: providerUrl } });
    await input.prisma.externalEntityLink.create({ data: { workspaceId: binding.project.workspaceId, projectId: binding.project.id, connectionId: connection.id, entityType: "ticket", entityId: card.id, providerEntityType: "discord_message", providerEntityId: targetId, providerUrl, metadata: JSON.stringify({ channelId, authorDiscordId: message.author?.id || null }) } });
    await input.logActivity({ userId: user.id, projectId: binding.project.id, boardId: board.id, cardId: card.id, type: "created", entityType: "ticket", entityId: card.id, title: "Ticket created from Discord", message: card.title, metadata: { discordMessageId: targetId, discordChannelId: channelId, notifyInbox: true, assigneeId: user.id } });
    return { ticket: card, existing: false };
  }

  async function projectStatusFromInteraction(connection: any, interaction: any, actorDiscordId: string) {
    const settings = await input.readSettings();
    const channelId = cleanText(interaction.channel_id, 120);
    const binding = await projectRouteForChannel(connection.id, channelId, settings);
    if (!binding?.project) throw createHttpError("DISCORD_PROJECT_ROUTE_REQUIRED", "This Discord channel is not routed to a Cluster project.", 409);
    await authorizeDiscordUser(actorDiscordId, binding.project, "projects", "view");
    const [openTickets, openReviews, latestVersion] = await Promise.all([
      input.prisma.card.count({ where: { list: { board: { projectId: binding.project.id, archived: false }, isDone: false }, archived: false } }).catch(() => 0),
      input.prisma.sourceReview.count({ where: { projectId: binding.project.id, status: { in: ["open", "ready", "changes_requested"] } } }).catch(() => 0),
      input.prisma.projectVersion.findFirst({ where: { projectId: binding.project.id }, orderBy: { createdAt: "desc" }, select: { label: true, status: true } }).catch(() => null),
    ]);
    const status = cleanText(binding.project.status || "active", 80).replace(/_/g, " ");
    const versionText = latestVersion?.label ? ` · Version ${cleanText(latestVersion.label, 80)}` : "";
    return interactionResponse(`${cleanText(binding.project.name, 180)} · ${status} · ${openTickets} open ticket${openTickets === 1 ? "" : "s"} · ${openReviews} open review${openReviews === 1 ? "" : "s"}${versionText}`);
  }

  async function processVerifiedInteraction(interaction: any) {
    const settings = await input.readSettings();
    if (settings.discordApplicationId && cleanText(interaction?.application_id, 120) !== settings.discordApplicationId) throw createHttpError("DISCORD_APPLICATION_MISMATCH", "Discord interaction does not belong to the configured application.", 403);
    if (interaction?.type === 1) return { type: 1 };
    if (settings.discordGuildId && cleanText(interaction?.guild_id, 120) !== settings.discordGuildId) throw createHttpError("DISCORD_GUILD_MISMATCH", "Discord interaction does not belong to the configured server.", 403);
    const connection = await activeConnection();
    const interactionId = cleanText(interaction?.id, 120);
    if (!interactionId) throw createHttpError("DISCORD_INTERACTION_INVALID", "Discord interaction ID is missing.", 400);
    const eventPayload = JSON.stringify({ id: interactionId, type: interaction.type, applicationId: cleanText(interaction.application_id, 120) || null, guildId: cleanText(interaction.guild_id, 120) || null, channelId: cleanText(interaction.channel_id, 120) || null, data: interaction.data || null, memberUserId: cleanText(interaction.member?.user?.id || interaction.user?.id, 120) || null });
    const event = await input.prisma.integrationEventInbox.upsert({ where: { connectionId_providerEventId: { connectionId: connection.id, providerEventId: interactionId } }, create: { connectionId: connection.id, providerEventId: interactionId, eventType: `discord.interaction.${interaction.type}`, payload: eventPayload, status: "pending" }, update: {} });
    const actionKey = `discord-interaction:${interactionId}`;
    const existingReceipt = await input.prisma.integrationActionReceipt.findUnique({ where: { connectionId_actionKey: { connectionId: connection.id, actionKey } } });
    if (existingReceipt?.status === "completed") return parseObject(existingReceipt.responseMetadata).interactionResponse || interactionResponse("This action was already completed in Cluster.");
    const receipt = existingReceipt || await input.prisma.integrationActionReceipt.create({ data: { connectionId: connection.id, actionKey, actionType: "discord.interaction", status: "running", responseMetadata: "{}" } });
    const actorDiscordId = cleanText(interaction.member?.user?.id || interaction.user?.id, 120);
    try {
      let response: any;
      let entityType: string | null = null;
      let entityId: string | null = null;
      if (interaction.type === 3) {
        const customId = cleanText(interaction?.data?.custom_id, 100);
        const ack = /^cl:ack:([^:]+)$/.exec(customId);
        const approve = /^cl:review:approve:([^:]+):([^:]+)$/.exec(customId);
        if (ack) {
          const item = await input.prisma.notificationInboxItem.findFirst({ where: { user: { discordUserId: actorDiscordId }, activityEventId: ack[1] } });
          if (!item) throw createHttpError("DISCORD_NOTIFICATION_NOT_FOUND", "No matching Cluster Inbox item is available for your account.", 404);
          await input.notificationService.acknowledge(item.userId, [item.id], true);
          entityType = "notification"; entityId = item.id;
          response = interactionResponse("Acknowledged in Cluster.");
        } else if (approve) {
          const project = await input.prisma.project.findFirst({ where: { id: approve[1], archived: false } });
          if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
          const { user } = await authorizeDiscordUser(actorDiscordId, project, "projects", "contribute");
          if (!input.sourceControl) throw createHttpError("SOURCE_CONTROL_UNAVAILABLE", "Source Control is unavailable.", 503);
          await input.sourceControl.setReviewDecision(approve[2], project.id, user.id, "approved", "Approved from Discord.");
          const review = await input.sourceControl.reviewEligibility(approve[2], true);
          entityType = "source_review"; entityId = approve[2];
          response = interactionResponse(review?.eligibilityState === "ready" ? "Review approved. It is ready to merge in Cluster." : `Review approved. ${review?.eligibilityMessage || "Cluster will recheck merge requirements."}`);
        } else {
          throw createHttpError("DISCORD_ACTION_UNSUPPORTED", "This Discord action is not supported.", 400);
        }
      } else if (interaction.type === 2 && interaction?.data?.type === 1 && interaction?.data?.name === "cluster") {
        const subcommand = cleanText(interaction?.data?.options?.[0]?.name, 80);
        if (subcommand === "status") {
          response = await projectStatusFromInteraction(connection, interaction, actorDiscordId);
        } else if (subcommand === "help") {
          response = interactionResponse("Cluster Discord commands: /cluster status shows the Project routed to this channel. Use Apps → Create Cluster Ticket on a Discord message to create a linked Ticket. Cluster account linking and Project permissions are always enforced.");
        } else {
          throw createHttpError("DISCORD_ACTION_UNSUPPORTED", "This Cluster Discord command is not supported.", 400);
        }
      } else if (interaction.type === 2 && interaction?.data?.type === 3 && interaction?.data?.name === "Create Cluster Ticket") {
        const result = await createTicketFromInteraction(connection, interaction, actorDiscordId);
        entityType = "ticket"; entityId = result.ticket?.id || null;
        response = interactionResponse(result.existing ? "That Discord message is already linked to a Cluster ticket." : `Ticket created in Cluster: ${cleanText(result.ticket?.title, 160)}`);
      } else {
        throw createHttpError("DISCORD_ACTION_UNSUPPORTED", "This Discord interaction is not supported by Cluster.", 400);
      }
      await input.prisma.$transaction([
        input.prisma.integrationEventInbox.update({ where: { id: event.id }, data: { status: "processed", processedAt: new Date(), attempts: { increment: 1 }, lastError: null } }),
        input.prisma.integrationActionReceipt.update({ where: { id: receipt.id }, data: { status: "completed", entityType, entityId, responseMetadata: JSON.stringify({ interactionResponse: response }), completedAt: new Date(), attempts: { increment: 1 }, lastError: null } }),
      ]);
      return response;
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error, 1_000) || "Discord interaction failed.";
      const response = interactionResponse(message);
      await input.prisma.$transaction([
        input.prisma.integrationEventInbox.update({ where: { id: event.id }, data: { status: "failed", processedAt: new Date(), attempts: { increment: 1 }, lastError: message } }),
        input.prisma.integrationActionReceipt.update({ where: { id: receipt.id }, data: { status: "completed", responseMetadata: JSON.stringify({ interactionResponse: response, failed: true }), completedAt: new Date(), attempts: { increment: 1 }, lastError: message } }),
      ]).catch(() => undefined);
      return response;
    }
  }

  async function processInteraction(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const settings = await input.readSettings();
    const signature = cleanText(headers["x-signature-ed25519"], 256);
    const timestamp = cleanText(headers["x-signature-timestamp"], 64);
    const publicKey = cleanText(settings.discordApplicationPublicKey, 256);
    if (!publicKey || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) throw createHttpError("DISCORD_SIGNATURE_INVALID", "Discord interaction signature is invalid.", 401);
    let interaction: any;
    try { interaction = JSON.parse(rawBody.toString("utf8")); } catch { throw createHttpError("DISCORD_INTERACTION_INVALID", "Discord interaction payload is invalid.", 400); }
    return processVerifiedInteraction(interaction);
  }

  async function processGatewayInteraction(interaction: any) {
    if (!interaction || typeof interaction !== "object" || Array.isArray(interaction)) throw createHttpError("DISCORD_INTERACTION_INVALID", "Discord interaction payload is invalid.", 400);
    return processVerifiedInteraction(interaction);
  }

  async function syncCommands() {
    const settings = await input.readSettings(true);
    if (!settings.discordApplicationId || !settings.discordGuildId) throw createHttpError("DISCORD_APPLICATION_REQUIRED", "Configure the Discord application ID and server ID before syncing commands.", 409);
    const commands = [
      {
        name: "cluster",
        description: "Work with Cluster from this Discord server.",
        type: 1,
        dm_permission: false,
        default_member_permissions: null,
        options: [
          { type: 1, name: "status", description: "Show the Cluster Project status for this channel." },
          { type: 1, name: "help", description: "Show the Cluster Discord command surface." },
        ],
      },
      { name: "Create Cluster Ticket", type: 3, dm_permission: false, default_member_permissions: null },
    ];
    const result = await input.discordRequest(settings, `/applications/${encodeURIComponent(settings.discordApplicationId)}/guilds/${encodeURIComponent(settings.discordGuildId)}/commands`, { method: "PUT", body: commands });
    return { commands: Array.isArray(result) ? result.map((row: any) => ({ id: row.id, name: row.name, type: row.type })) : [] };
  }

  return { projectRoutes, upsertProjectRoute, archiveProjectRoute, availableChannels, reconcileRoutes, deliverySummary, retryDelivery, enqueueNotification, repairPendingDeliveries, executeDelivery, processInteraction, processGatewayInteraction, syncCommands, eventClassForNotification, discordNotificationPresentation };
}
