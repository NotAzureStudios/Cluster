CREATE TABLE "BehavioralAnalyticsProvider" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "adapter" TEXT NOT NULL DEFAULT 'cluster_first_party',
  "purpose" TEXT NOT NULL,
  "dataCategoriesJson" TEXT NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "collectScreenViews" BOOLEAN NOT NULL DEFAULT true,
  "collectFeatureActions" BOOLEAN NOT NULL DEFAULT false,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BehavioralAnalyticsProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BehavioralAnalyticsEvent" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "client" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BehavioralAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BehavioralAnalyticsProvider_enabled_reviewedAt_idx" ON "BehavioralAnalyticsProvider"("enabled", "reviewedAt");
CREATE INDEX "BehavioralAnalyticsProvider_adapter_idx" ON "BehavioralAnalyticsProvider"("adapter");
CREATE INDEX "BehavioralAnalyticsEvent_providerId_createdAt_idx" ON "BehavioralAnalyticsEvent"("providerId", "createdAt");
CREATE INDEX "BehavioralAnalyticsEvent_userId_createdAt_idx" ON "BehavioralAnalyticsEvent"("userId", "createdAt");
CREATE INDEX "BehavioralAnalyticsEvent_eventName_createdAt_idx" ON "BehavioralAnalyticsEvent"("eventName", "createdAt");
CREATE INDEX "BehavioralAnalyticsEvent_surface_createdAt_idx" ON "BehavioralAnalyticsEvent"("surface", "createdAt");
ALTER TABLE "BehavioralAnalyticsEvent" ADD CONSTRAINT "BehavioralAnalyticsEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "BehavioralAnalyticsProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BehavioralAnalyticsEvent" ADD CONSTRAINT "BehavioralAnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BehavioralAnalyticsProvider" ("id", "name", "adapter", "purpose", "dataCategoriesJson", "enabled", "collectScreenViews", "collectFeatureActions", "updatedAt")
VALUES ('builtin-cluster-first-party', 'Cluster first-party usage analytics', 'cluster_first_party', 'Measure coarse application usage and screen adoption on this self-hosted Cluster server without sending behavioral analytics to an external provider.', '["coarse screen identifier","event type","web or desktop client type","event timestamp"]', false, true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
