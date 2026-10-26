import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  privacyConsentInventory,
  PRIVACY_CONSENT_NOTICE_VERSION,
  PRIVACY_CONSENT_SCHEMA_VERSION,
  normalizePrivacyConsentChoice,
  serializePrivacyConsent,
} from "../../core/privacy-consent.js";

const consentSchema = z.object({
  preferences: z.boolean(),
  analytics: z.boolean().optional().default(false),
  externalContent: z.boolean(),
  source: z.enum(["web", "desktop"]).optional().default("web"),
  noticeVersion: z.string().trim().min(1).max(32).optional(),
});

export function registerPrivacyConsentRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
}) {
  const { app, prisma, getCurrentUser } = deps;

  app.get("/api/public/privacy/consent-config", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300, must-revalidate");
    return { ok: true, ...(await privacyConsentInventory(prisma)) };
  });

  app.get("/api/privacy/consent", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const consent = await prisma.privacyConsentPreference.findUnique({ where: { userId: user.id } });
    return {
      ok: true,
      currentNoticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
      consent: serializePrivacyConsent(consent),
    };
  });

  app.put("/api/privacy/consent", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const parsed = consentSchema.parse(request.body || {});
    if (parsed.noticeVersion && parsed.noticeVersion !== PRIVACY_CONSENT_NOTICE_VERSION) {
      return reply.code(409).send({
        ok: false,
        code: "PRIVACY_CONSENT_NOTICE_STALE",
        error: "Privacy choices are based on an outdated consent notice. Refresh Cluster and review the current choices.",
        currentNoticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
      });
    }
    const inventory = await privacyConsentInventory(prisma);
    const choice = normalizePrivacyConsentChoice(parsed, { analyticsAvailable: inventory.analyticsProviders.length > 0 });
    const now = new Date();
    const consent = await prisma.privacyConsentPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        schemaVersion: PRIVACY_CONSENT_SCHEMA_VERSION,
        noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
        ...choice,
        source: parsed.source,
        decidedAt: now,
      },
      update: {
        schemaVersion: PRIVACY_CONSENT_SCHEMA_VERSION,
        noticeVersion: PRIVACY_CONSENT_NOTICE_VERSION,
        ...choice,
        source: parsed.source,
        decidedAt: now,
      },
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, consent: serializePrivacyConsent(consent) };
  });
}
