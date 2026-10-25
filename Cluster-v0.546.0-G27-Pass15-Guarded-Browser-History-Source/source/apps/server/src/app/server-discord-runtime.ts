import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { BackgroundTaskRegistry } from "../core/background-tasks.js";
import type { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import type { DurableJobWorker } from "../domains/jobs/job-worker.js";
import type { SettingPayload } from "./server-composition-types.js";
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

  // Recover durable Discord receipts left pending by interrupted queue writes
  // or server restarts. The shared task registry applies pressure-aware idle
  // backoff, and the job queue itself deduplicates by the original action key.
  input.backgroundTasks?.scheduleAdaptive("discord-receipt-recovery", 5 * 60_000, async () => {
    const outcome = await discord.repairPendingDeliveries(100);
    return { activity: outcome.requeued > 0 ? "active" : "idle" };
  }, { runImmediately: false, maxBackoffMs: 30 * 60_000, workloadClass: "maintenance" });

  // Optional outbound-only Discord Gateway relay for private/self-hosted Cluster installs.
  // The relay token is runtime-only and deliberately separate from the Discord bot token.
  input.app.post("/api/integrations/discord/gateway-relay", async (request: any, reply: any) => {
    const relayTokens = [
      String(process.env.CLUSTER_DISCORD_RELAY_TOKEN || "").trim(),
      String(process.env.CLUSTER_DISCORD_RELAY_TOKEN_PREVIOUS || "").trim(),
    ].filter((value, index, values) => value.length >= 32 && values.indexOf(value) === index);
    const supplied = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const authorized = relayTokens.some((expected) => supplied.length === expected.length
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

  return { discord };
}
