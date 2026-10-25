import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { serializeWebhookDelivery, serializeWebhookEndpoint, type createWebhookIntegrationService } from "./webhook-service.js";
import { currentReliabilityContext } from "../../core/reliability-context.js";

type WebhookService = ReturnType<typeof createWebhookIntegrationService>;

const eventTypesSchema = z.array(z.string().trim().min(1).max(120)).min(1).max(128);
const endpointInput = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2048),
  eventTypes: eventTypesSchema,
  projectId: z.string().trim().min(1).max(200).nullable().optional(),
  allowPrivateNetwork: z.boolean().optional().default(false),
  allowHttpPrivateNetwork: z.boolean().optional().default(false),
  timeoutMs: z.number().int().min(1_000).max(30_000).optional().default(10_000),
});

export function registerIntegrationWebhookRoutes(input: {
  app: FastifyInstance;
  prisma: any;
  webhooks: WebhookService;
  authorization: { requireTool: (request: FastifyRequest, reply: FastifyReply, tool: string, minimum?: string) => Promise<any | null> };
  requireConfirmation?: (request: FastifyRequest, reply: FastifyReply, phrase: string) => boolean;
}) {
  const { app, prisma, webhooks } = input;

  app.get("/api/admin/integrations/webhooks", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "view");
    if (!admin) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query || {});
    const workspaceId = currentReliabilityContext()?.workspaceId || null;
    if (!workspaceId) return reply.code(409).send({ ok: false, code: "WORKSPACE_CONTEXT_REQUIRED", error: "An active workspace is required." });
    const endpoints = await prisma.integrationWebhookEndpoint.findMany({ where: { workspaceId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit });
    const endpointIds = endpoints.map((row: any) => row.id);
    const deliveries = endpointIds.length ? await prisma.integrationWebhookDelivery.findMany({
      where: { endpointId: { in: endpointIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(500, query.limit * 5),
    }) : [];
    reply.header("Cache-Control", "no-store");
    return { ok: true, contractVersion: 1, endpoints: endpoints.map(serializeWebhookEndpoint), deliveries: deliveries.map(serializeWebhookDelivery) };
  });

  app.post("/api/admin/integrations/webhooks", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    try {
      const body = endpointInput.parse(request.body);
      const created = await webhooks.createEndpoint({ ...body, createdById: admin.id });
      reply.header("Cache-Control", "no-store");
      reply.code(201);
      return { ok: true, contractVersion: 1, ...created, copyOnce: true };
    } catch (error) {
      return reply.code(400).send({ ok: false, code: "WEBHOOK_CONFIGURATION_INVALID", error: error instanceof Error ? error.message : "Webhook configuration is invalid." });
    }
  });

  app.patch("/api/admin/integrations/webhooks/:endpointId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const { endpointId } = z.object({ endpointId: z.string().min(1).max(200) }).parse(request.params);
    try {
      const patch = endpointInput.partial().parse(request.body || {});
      const endpoint = await webhooks.updateEndpoint(endpointId, patch);
      if (!endpoint) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Webhook endpoint not found." });
      reply.header("Cache-Control", "no-store");
      return { ok: true, endpoint };
    } catch (error) {
      return reply.code(400).send({ ok: false, code: "WEBHOOK_CONFIGURATION_INVALID", error: error instanceof Error ? error.message : "Webhook configuration is invalid." });
    }
  });

  app.delete("/api/admin/integrations/webhooks/:endpointId", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    if (input.requireConfirmation && !input.requireConfirmation(request, reply, "DELETE WEBHOOK")) return;
    const { endpointId } = z.object({ endpointId: z.string().min(1).max(200) }).parse(request.params);
    const deleted = await webhooks.deleteEndpoint(endpointId);
    if (!deleted) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Webhook endpoint not found." });
    return { ok: true };
  });

  app.post("/api/admin/integrations/webhooks/:endpointId/rotate-secret", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    if (input.requireConfirmation && !input.requireConfirmation(request, reply, "ROTATE WEBHOOK SECRET")) return;
    const { endpointId } = z.object({ endpointId: z.string().min(1).max(200) }).parse(request.params);
    try {
      const rotated = await webhooks.rotateSigningSecret(endpointId);
      if (!rotated) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Webhook endpoint not found." });
      reply.header("Cache-Control", "no-store");
      return { ok: true, ...rotated, copyOnce: true };
    } catch (error) {
      return reply.code(409).send({ ok: false, code: "WEBHOOK_SIGNING_CREDENTIAL_UNAVAILABLE", error: error instanceof Error ? error.message : "Webhook secret could not be rotated." });
    }
  });

  app.post("/api/admin/integrations/webhooks/:endpointId/test", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const { endpointId } = z.object({ endpointId: z.string().min(1).max(200) }).parse(request.params);
    const delivery = await webhooks.testEndpoint(endpointId, admin.id);
    if (!delivery) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Webhook endpoint not found." });
    reply.code(202);
    return { ok: true, delivery };
  });

  app.post("/api/admin/integrations/webhooks/deliveries/:deliveryId/retry", async (request, reply) => {
    const admin = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!admin) return;
    const { deliveryId } = z.object({ deliveryId: z.string().min(1).max(200) }).parse(request.params);
    try {
      const delivery = await webhooks.retryDelivery(deliveryId);
      if (!delivery) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Webhook delivery not found." });
      reply.code(202);
      return { ok: true, delivery };
    } catch (error) {
      return reply.code(409).send({ ok: false, code: "WEBHOOK_RETRY_UNAVAILABLE", error: error instanceof Error ? error.message : "Webhook delivery cannot be retried." });
    }
  });
}
