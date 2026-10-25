-- Block 31C: indexes matched to high-frequency bounded read/claim predicates.
-- Partial indexes keep hot indexes small and avoid charging inactive/archive rows forever.

CREATE INDEX IF NOT EXISTS "KnowledgeItem_active_updatedAt_idx"
  ON "KnowledgeItem" ("updatedAt" DESC)
  WHERE "status" <> 'archived';

CREATE INDEX IF NOT EXISTS "KnowledgeItem_active_folder_title_idx"
  ON "KnowledgeItem" ("type", "title", "id")
  WHERE "status" <> 'archived';

CREATE INDEX IF NOT EXISTS "NotificationInboxItem_unread_user_created_idx"
  ON "NotificationInboxItem" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL AND "dismissedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "BackgroundJob_claim_queued_idx"
  ON "BackgroundJob" ("queue", "priority" DESC, "runAfter" ASC, "createdAt" ASC)
  WHERE "status" = 'QUEUED' AND "cancelRequestedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "BackgroundJob_claim_expired_lease_idx"
  ON "BackgroundJob" ("queue", "leaseExpiresAt" ASC)
  WHERE "status" = 'RUNNING' AND "cancelRequestedAt" IS NULL;
