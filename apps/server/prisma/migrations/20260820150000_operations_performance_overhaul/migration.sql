-- Core Product & Architecture Roadmap Step 6: Operations & Performance Overhaul.
CREATE TABLE "NotificationInboxItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityEventId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'activity',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "projectId" TEXT,
    "projectLabel" TEXT,
    "boardId" TEXT,
    "cardId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorLabel" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationInboxItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationInboxItem_userId_activityEventId_key" ON "NotificationInboxItem"("userId", "activityEventId");
CREATE INDEX "NotificationInboxItem_userId_dismissedAt_createdAt_idx" ON "NotificationInboxItem"("userId", "dismissedAt", "createdAt");
CREATE INDEX "NotificationInboxItem_userId_readAt_createdAt_idx" ON "NotificationInboxItem"("userId", "readAt", "createdAt");
CREATE INDEX "NotificationInboxItem_userId_snoozedUntil_createdAt_idx" ON "NotificationInboxItem"("userId", "snoozedUntil", "createdAt");
CREATE INDEX "NotificationInboxItem_userId_priority_createdAt_idx" ON "NotificationInboxItem"("userId", "priority", "createdAt");
CREATE INDEX "NotificationInboxItem_userId_category_createdAt_idx" ON "NotificationInboxItem"("userId", "category", "createdAt");
CREATE INDEX "NotificationInboxItem_projectId_createdAt_idx" ON "NotificationInboxItem"("projectId", "createdAt");
CREATE INDEX "NotificationInboxItem_createdAt_idx" ON "NotificationInboxItem"("createdAt");
ALTER TABLE "NotificationInboxItem" ADD CONSTRAINT "NotificationInboxItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ActivityEvent_cardId_createdAt_idx" ON "ActivityEvent"("cardId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityEvent_type_createdAt_idx" ON "ActivityEvent"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityEvent_entityType_createdAt_idx" ON "ActivityEvent"("entityType", "createdAt");
