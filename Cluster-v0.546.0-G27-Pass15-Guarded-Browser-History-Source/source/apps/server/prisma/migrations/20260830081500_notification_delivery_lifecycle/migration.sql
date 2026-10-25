ALTER TABLE "NotificationInboxItem"
  ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastEscalatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "NotificationInboxItem_userId_requiresAction_acknowledgedAt_escalationLevel_createdAt_idx"
  ON "NotificationInboxItem"("userId", "requiresAction", "acknowledgedAt", "escalationLevel", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationInboxItem_lastEscalatedAt_idx"
  ON "NotificationInboxItem"("lastEscalatedAt");

CREATE TABLE IF NOT EXISTS "NotificationDigestDelivery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cadence" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "notificationInboxItemId" TEXT,
  "summaryJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDigestDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDigestDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDigestDelivery_userId_cadence_periodKey_key"
  ON "NotificationDigestDelivery"("userId", "cadence", "periodKey");
CREATE INDEX IF NOT EXISTS "NotificationDigestDelivery_scheduledFor_deliveredAt_idx"
  ON "NotificationDigestDelivery"("scheduledFor", "deliveredAt");
CREATE INDEX IF NOT EXISTS "NotificationDigestDelivery_userId_deliveredAt_idx"
  ON "NotificationDigestDelivery"("userId", "deliveredAt");
CREATE INDEX IF NOT EXISTS "NotificationDigestDelivery_createdAt_idx"
  ON "NotificationDigestDelivery"("createdAt");
