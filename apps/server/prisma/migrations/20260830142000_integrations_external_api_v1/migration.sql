CREATE TABLE IF NOT EXISTS "IntegrationWebhookEndpoint" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "encryptedUrl" TEXT NOT NULL,
  "urlDisplay" TEXT NOT NULL,
  "eventTypes" TEXT NOT NULL DEFAULT '[]',
  "projectId" TEXT,
  "signingCredentialId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allowPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
  "allowHttpPrivateNetwork" BOOLEAN NOT NULL DEFAULT false,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "createdById" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationWebhookEndpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IntegrationWebhookEndpoint_enabled_projectId_createdAt_idx" ON "IntegrationWebhookEndpoint"("enabled", "projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "IntegrationWebhookEndpoint_signingCredentialId_idx" ON "IntegrationWebhookEndpoint"("signingCredentialId");
CREATE INDEX IF NOT EXISTS "IntegrationWebhookEndpoint_createdById_createdAt_idx" ON "IntegrationWebhookEndpoint"("createdById", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'IntegrationWebhookEndpoint_signingCredentialId_fkey'
  ) THEN
    ALTER TABLE "IntegrationWebhookEndpoint"
      ADD CONSTRAINT "IntegrationWebhookEndpoint_signingCredentialId_fkey"
      FOREIGN KEY ("signingCredentialId") REFERENCES "ServiceCredential"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "IntegrationWebhookDelivery" (
  "id" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastStatusCode" INTEGER,
  "lastError" TEXT,
  "latencyMs" INTEGER,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationWebhookDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationWebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "IntegrationWebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationWebhookDelivery_endpointId_eventId_key" ON "IntegrationWebhookDelivery"("endpointId", "eventId");
CREATE INDEX IF NOT EXISTS "IntegrationWebhookDelivery_status_createdAt_idx" ON "IntegrationWebhookDelivery"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "IntegrationWebhookDelivery_endpointId_createdAt_idx" ON "IntegrationWebhookDelivery"("endpointId", "createdAt");
CREATE INDEX IF NOT EXISTS "IntegrationWebhookDelivery_eventType_createdAt_idx" ON "IntegrationWebhookDelivery"("eventType", "createdAt");
