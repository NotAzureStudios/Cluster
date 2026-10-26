import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ANALYTICS_EVENT_NAMES,
  BUILTIN_ANALYTICS_PROVIDER_ID,
  analyticsEventInputSchema,
  analyticsProviderMaterialChanged,
  analyticsProviderUpdateSchema,
  ensureBuiltinAnalyticsProvider,
  readAnalyticsRetentionDays,
  readBuiltinAnalyticsProvider,
  serializeAnalyticsProvider,
} from "../../core/behavioral-analytics.js";
import { PRIVACY_CONSENT_NOTICE_VERSION } from "../../core/privacy-consent.js";

export function registerBehavioralAnalyticsRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
}) {
  const { app, prisma, getCurrentUser } = deps;

  app.post("/api/analytics/events", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const parsed = analyticsEventInputSchema.parse(request.body || {});
    const [provider, consent] = await Promise.all([
      readBuiltinAnalyticsProvider(prisma),
      prisma.privacyConsentPreference.findUnique({ where: { userId: user.id } }),
    ]);
    if (!provider.enabled || !provider.reviewedAt) {
      reply.header("Cache-Control", "no-store");
      return { ok: true, accepted: false, reason: "analytics_disabled" };
    }
    if (!consent || consent.noticeVersion !== PRIVACY_CONSENT_NOTICE_VERSION || consent.analytics !== true) {
      return reply.code(403).send({ ok: false, code: "ANALYTICS_CONSENT_REQUIRED", error: "Behavioral analytics consent is required before analytics events can be stored." });
    }
    if (parsed.eventName === "screen_view" && provider.collectScreenViews === false) return { ok: true, accepted: false, reason: "event_disabled" };
    if (!ANALYTICS_EVENT_NAMES.includes(parsed.eventName)) return reply.code(400).send({ ok: false, code: "ANALYTICS_EVENT_INVALID", error: "Analytics event is not allowed." });
    const occurredAt = parsed.occurredAt ? new Date(parsed.occurredAt) : new Date();
    const now = Date.now();
    if (Math.abs(occurredAt.getTime() - now) > 10 * 60 * 1000) {
      return reply.code(400).send({ ok: false, code: "ANALYTICS_EVENT_INVALID", error: "Analytics event timestamp is outside the accepted window." });
    }
    await prisma.behavioralAnalyticsEvent.create({ data: { providerId: provider.id, userId: user.id, eventName: parsed.eventName, surface: parsed.surface, client: parsed.client, occurredAt } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, accepted: true };
  });

  app.get("/api/admin/legal/analytics", async (_request, reply) => {
    const provider = await readBuiltinAnalyticsProvider(prisma);
    const retentionDays = await readAnalyticsRetentionDays(prisma);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [events30d, users30d, eventGroups, surfaceGroups] = await Promise.all([
      prisma.behavioralAnalyticsEvent.count({ where: { providerId: provider.id, createdAt: { gte: since30 } } }),
      prisma.behavioralAnalyticsEvent.groupBy({ by: ["userId"], where: { providerId: provider.id, createdAt: { gte: since30 } }, _count: { _all: true } }),
      prisma.behavioralAnalyticsEvent.groupBy({ by: ["eventName"], where: { providerId: provider.id, createdAt: { gte: since30 } }, _count: { _all: true }, orderBy: { _count: { eventName: "desc" } } }),
      prisma.behavioralAnalyticsEvent.groupBy({ by: ["surface"], where: { providerId: provider.id, eventName: "screen_view", createdAt: { gte: since30 } }, _count: { _all: true }, orderBy: { _count: { surface: "desc" } }, take: 12 }),
    ]);
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      provider: serializeAnalyticsProvider(provider, retentionDays),
      aggregate: {
        windowDays: 30,
        events: events30d,
        consentingUsersObserved: users30d.length,
        byEvent: eventGroups.map((row: any) => ({ eventName: row.eventName, count: row._count?._all || 0 })),
        topSurfaces: surfaceGroups.map((row: any) => ({ surface: row.surface, count: row._count?._all || 0 })),
        rawUserDrilldownAvailable: false,
      },
    };
  });

  app.patch("/api/admin/legal/analytics/provider", async (request, reply) => {
    const user = await getCurrentUser(request);
    const input = analyticsProviderUpdateSchema.parse(request.body || {});
    const existing = await ensureBuiltinAnalyticsProvider(prisma);
    const materialChanged = analyticsProviderMaterialChanged(existing, input);
    const explicitlyReviewed = input.reviewed === true;
    const reviewed = explicitlyReviewed ? true : input.reviewed === false ? false : materialChanged ? false : Boolean(existing.reviewedAt);
    const requestedEnabled = input.enabled === undefined ? existing.enabled === true : input.enabled;
    const enabled = reviewed ? requestedEnabled : false;
    if (input.enabled === true && !reviewed) {
      return reply.code(409).send({ ok: false, code: "ANALYTICS_PROVIDER_REVIEW_REQUIRED", error: "Review the current analytics provider configuration before enabling collection." });
    }
    const updated = await prisma.behavioralAnalyticsProvider.update({
      where: { id: BUILTIN_ANALYTICS_PROVIDER_ID },
      data: {
        name: input.name ?? existing.name,
        purpose: input.purpose ?? existing.purpose,
        collectScreenViews: input.collectScreenViews ?? existing.collectScreenViews,
        collectFeatureActions: false,
        enabled,
        reviewedAt: reviewed ? (explicitlyReviewed || !existing.reviewedAt ? new Date() : existing.reviewedAt) : null,
        reviewedById: reviewed ? (explicitlyReviewed || !existing.reviewedAt ? user?.id || null : existing.reviewedById) : null,
      },
    });
    const retentionDays = await readAnalyticsRetentionDays(prisma);
    reply.header("Cache-Control", "no-store");
    return { ok: true, provider: serializeAnalyticsProvider(updated, retentionDays), reviewInvalidated: materialChanged && !explicitlyReviewed };
  });
}
