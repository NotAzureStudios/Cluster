import { timingSafeEqual } from "node:crypto";
import { createDiscordBotSupervisor } from "./discord-bot-supervisor.js";
import type { FastifyInstance } from "fastify";
import type { BackgroundTaskRegistry } from "../core/background-tasks.js";
import type { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import type { DurableJobWorker } from "../domains/jobs/job-worker.js";
import type { SettingPayload } from "./server-composition-types.js";
import { createDiscordRoleProjectionService } from "../domains/integrations/discord-role-projection.js";
import { createDiscordProductionService } from "../domains/integrations/discord-production-service.js";
import { registerDiscordProductionRoutes } from "../domains/integrations/discord-production-routes.js";

export function createServerDiscordRuntime(input: {
  app: FastifyInstance;
  prisma: any;
  queue: BackgroundJobQueue;
  worker: DurableJobWorker;
  backgroundTasks?: BackgroundTaskRegistry;
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  discordRequest: (settings: SettingPayload, path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  notificationService: any;
  authorization: any;
  sourceControl: any;
  localDiscordUrl: string;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: any) => Promise<void>;
}) {
  const discord = createDiscordProductionService({
    prisma: input.prisma,
    queue: input.queue,
    readSettings: input.readSettings,
    discordRequest: input.discordRequest,
    notificationService: input.notificationService,
    authorization: input.authorization,
    sourceControl: input.sourceControl,
    logActivity: input.logActivity,
    logger: { info: (payload, message) => input.app.log.info(payload, message), warn: (payload, message) => input.app.log.warn(payload, message) },
  });

  input.worker.register("integration.discord-delivery", async ({ payload, job, cancellationRequested }) => {
    if (await cancellationRequested()) return { cancelled: true };
    const deliveryPayload = payload as { receiptId?: string };
    return discord.executeDelivery(String(deliveryPayload.receiptId || ""), Math.max(1, Number(job.attempts || 1)));
  });

  input.notificationService.setExternalDeliveryHandler((record: any) => discord.enqueueNotification(record));
  registerDiscordProductionRoutes({ app: input.app, service: discord, authorization: input.authorization, enforceTargetAccess: input.enforceTargetAccess, logActivity: input.logActivity });

  const roleProjection = createDiscordRoleProjectionService({
    prisma: input.prisma, readSettings: input.readSettings, discordRequest: input.discordRequest,
    logger: { warn: (data, message) => input.app.log.warn(data, message) },
  });
  // Opt-in only. No scheduled or outbound requests when synchronization is off.
  input.backgroundTasks?.scheduleAdaptive("discord-role-projection", 5 * 60_000, async () => {
    const result = await roleProjection.reconcile();
    return { activity: result.applied ? "active" : "idle" };
  }, { runImmediately: false, maxBackoffMs: 30 * 60_000, workloadClass: "maintenance" });
  input.app.get("/api/admin/integrations/discord/roles", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "view"))) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, ...(await roleProjection.list(String(request.query?.guildId || ""))) };
  });
  input.app.post("/api/admin/integrations/discord/roles/mappings", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    const source = request.body || {};
    if (source.sourceKind !== "accountType" && source.sourceKind !== "team") return reply.code(400).send({ ok: false, error: "Invalid mapping source." });
    const outcome = await roleProjection.addMapping({ guildId: String(source.guildId || ""), roleId: String(source.roleId || ""), sourceKind: source.sourceKind, sourceId: String(source.sourceId || "") });
    await input.logActivity({ userId: actor.id, type: "discord_role_mapping_added", entityType: "integration", title: "Discord role mapping added", metadata: { guildId: source.guildId, roleId: source.roleId, sourceKind: source.sourceKind, sourceId: source.sourceId } });
    return { ok: true, ...outcome };
  });
  input.app.delete("/api/admin/integrations/discord/roles/mappings/:id", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    const id = String(request.params?.id || "");
    const outcome = await roleProjection.removeMapping(id);
    await input.logActivity({ userId: actor.id, type: "discord_role_mapping_removed", entityType: "integration", title: "Discord role mapping removed", metadata: { mappingId: id } });
    return { ok: true, ...outcome };
  });
  input.app.put("/api/admin/integrations/discord/roles/sync", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ ok: false, error: "enabled must be boolean" });
    const outcome = await roleProjection.setEnabled(request.body.enabled);
    await input.logActivity({ userId: actor.id, type: "discord_role_sync_toggled", entityType: "integration", title: "Discord role synchronization changed", metadata: { enabled: request.body.enabled } });
    return { ok: true, ...outcome };
  });
  input.app.get("/api/admin/integrations/discord/roles/preview", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "view"))) return;
    reply.header("Cache-Control", "no-store");
    const planned = await roleProjection.plan();
    return { ok: true, enabled: planned.enabled, grants: planned.totalGrants, revokes: planned.totalRevokes, uncertain: planned.uncertain, limitPerRun: 25 };
  });
  input.app.post("/api/admin/integrations/discord/roles/reconcile", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    const outcome = await roleProjection.reconcile();
    await input.logActivity({ userId: actor.id, type: "discord_role_reconciled", entityType: "integration", title: "Discord role projection reconciled", metadata: { applied: outcome.applied, failed: outcome.failed, skipped: outcome.skipped } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, ...outcome };
  });


  // Recover durable Discord receipts left pending by interrupted queue writes
  // or server restarts. The shared task registry applies pressure-aware idle
  // backoff, and the job queue itself deduplicates by the original action key.
  input.backgroundTasks?.scheduleAdaptive("discord-receipt-recovery", 5 * 60_000, async () => {
    const outcome = await discord.repairPendingDeliveries(100);
    return { activity: outcome.requeued > 0 ? "active" : "idle" };
  }, { runImmediately: false, maxBackoffMs: 30 * 60_000, workloadClass: "maintenance" });

  const botSupervisor = createDiscordBotSupervisor({
    readSettings: input.readSettings,
    readManaged: async () => {
      const connection = await input.prisma.integrationConnection.findFirst({ where: { providerId: "communication.discord", archived: false }, orderBy: { createdAt: "asc" } });
      if (!connection || connection.status === "disabled") return false;
      try { return JSON.parse(String(connection.configuration || "{}")).managedBot === true; } catch { return false; }
    },
    localUrl: input.localDiscordUrl,
    log: input.app.log,
  });
  input.app.addHook("onReady", async () => { await botSupervisor.restore(); });
  input.app.addHook("onClose", async () => { botSupervisor.close(); });

  input.app.get("/api/admin/integrations/discord/bot", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "view"))) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, bot: botSupervisor.status() };
  });
  input.app.put("/api/admin/integrations/discord/bot", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ ok: false, error: "enabled must be a boolean" });
    const connection = await input.prisma.integrationConnection.findFirst({ where: { providerId: "communication.discord", archived: false }, orderBy: { createdAt: "asc" } });
    if (!connection || connection.status === "disabled") return reply.code(409).send({ ok: false, error: "Configure and enable the Discord connection first." });
    let configuration: Record<string, unknown> = {};
    try { configuration = JSON.parse(String(connection.configuration || "{}")); } catch { /* old configuration */ }
    await input.prisma.integrationConnection.update({ where: { id: connection.id }, data: { configuration: JSON.stringify({ ...configuration, managedBot: request.body.enabled }) } });
    const bot = await botSupervisor.setManaged(request.body.enabled);
    await input.logActivity({ userId: actor.id, type: "discord_bot_lifecycle", entityType: "integration", entityId: connection.id, title: request.body.enabled ? "Discord bot enabled" : "Discord bot stopped", metadata: { enabled: request.body.enabled } });
    return { ok: true, bot };
  });

  // A connected state must come from the currently supervised worker, not a
  // cached stdout line or an externally configured relay token.
  input.app.post("/api/integrations/discord/gateway-health", async (request: any, reply: any) => {
    const supplied = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!botSupervisor.authorizedRelayToken(supplied))
      return reply.code(401).send({ ok: false, error: { code: "DISCORD_RELAY_UNAUTHORIZED", message: "Managed Discord worker authentication failed." } });
    const state = request.body?.state;
    if (state !== "connected" && state !== "reconnecting" && state !== "error")
      return reply.code(400).send({ ok: false, error: { code: "DISCORD_HEALTH_INVALID", message: "Unknown Discord Gateway state." } });
    botSupervisor.reportGatewayState(state);
    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });

  // Outbound-only Gateway relay; runtime token exists only in server memory.
  // The relay token is runtime-only and deliberately separate from the Discord bot token.
  input.app.post("/api/integrations/discord/gateway-relay", async (request: any, reply: any) => {
    const relayTokens = [
      String(process.env.CLUSTER_DISCORD_RELAY_TOKEN || "").trim(),
      String(process.env.CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS || "").trim(),
    ].filter((value, index, values) => value.length >= 32 && values.indexOf(value) === index);
    const supplied = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const authorized = (botSupervisor.authorizedRelayToken(supplied) && supplied.length >= 32) || relayTokens.some((expected) => supplied.length === expected.length
      && timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8")));
    if (!authorized) return reply.code(401).send({ ok: false, error: { code: "DISCORD_RELAY_UNAUTHORIZED", message: "Discord Gateway relay authentication failed." } });
    try {
      const response = await discord.processGatewayInteraction(request.body);
      return { ok: true, response };
    } catch (error: any) {
      return reply.code(Number(error?.statusCode || 400)).send({ ok: false, error: { code: error?.code || "DISCORD_INTERACTION_FAILED", message: String(error?.message || "Discord interaction failed.") } });
    }
  });

  input.app.register(async (instance) => {
    instance.removeContentTypeParser("application/json");
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    instance.post("/api/integrations/discord/interactions", async (request: any, reply: any) => {
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(String(request.body || ""), "utf8");
      try {
        return await discord.processInteraction(rawBody, request.headers || {});
      } catch (error: any) {
        return reply.code(Number(error?.statusCode || 401)).send({ error: { code: error?.code || "DISCORD_INTERACTION_FAILED", message: String(error?.message || "Discord interaction failed.") } });
      }
    });
  });

  return { discord, botSupervisor };
}
