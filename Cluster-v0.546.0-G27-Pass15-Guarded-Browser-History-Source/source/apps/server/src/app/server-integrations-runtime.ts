import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DurableDomainEventRuntime } from "../core/domain-events.js";
import { credentialExpiryForPolicy, credentialScopesAllowed, normalizeStudioSecurityPolicy } from "../core/studio-security-policy.js";
import { createServiceCredentialService } from "../domains/auth/service-credential-service.js";
import { registerIntegrationWebhookRoutes } from "../domains/integrations/integration-webhook-routes.js";
import { registerPublicApiRoutes } from "../domains/integrations/public-api-routes.js";
import { createWebhookIntegrationService } from "../domains/integrations/webhook-service.js";
import type { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";

export function createServerIntegrationsRuntime(input: {
  app: FastifyInstance;
  prisma: any;
  queue: BackgroundJobQueue;
  events: DurableDomainEventRuntime;
  readSettings: (force?: boolean) => Promise<Record<string, any>>;
  sessionDefaults: { sessionDays: number; sessionIdleHours: number; sessionMaxPerUser: number };
  authorization: { requireTool: (request: FastifyRequest, reply: FastifyReply, tool: string, minimum?: string) => Promise<any | null> };
  requireConfirmation: (request: FastifyRequest, reply: FastifyReply, phrase: string) => boolean;
}) {
  const credentialPolicy = async () => normalizeStudioSecurityPolicy(await input.readSettings(), input.sessionDefaults);
  const credentials = createServiceCredentialService(input.prisma, { getPolicy: credentialPolicy });
  const webhookCredentials = {
    create: async (data: { name: string; credentialType: "webhook_signing"; scopes: string[]; expiresAt?: Date | null; createdById?: string | null }) => {
      const policy = await credentialPolicy();
      if (!credentialScopesAllowed(policy, data.scopes)) throw new Error("Webhook signing scope is disabled by Studio credential policy.");
      const expiresAt = credentialExpiryForPolicy(policy, data.expiresAt);
      return credentials.create({ ...data, expiresAt });
    },
    webhookSecret: credentials.webhookSecret,
  };
  const webhooks = createWebhookIntegrationService({
    prisma: input.prisma,
    queue: input.queue,
    events: input.events,
    credentials: webhookCredentials,
    logger: {
      info: (payload, message) => input.app.log.info(payload, message),
      warn: (payload, message) => input.app.log.warn(payload, message),
    },
  });
  registerIntegrationWebhookRoutes({ app: input.app, prisma: input.prisma, webhooks, authorization: input.authorization, requireConfirmation: input.requireConfirmation });
  registerPublicApiRoutes({ app: input.app, prisma: input.prisma, credentials });
  return { credentials, webhooks };
}
