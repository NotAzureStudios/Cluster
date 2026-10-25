ALTER TABLE "NotificationInboxItem"
  ADD COLUMN IF NOT EXISTS "groupKey" TEXT,
  ADD COLUMN IF NOT EXISTS "tool" TEXT,
  ADD COLUMN IF NOT EXISTS "signal" TEXT,
  ADD COLUMN IF NOT EXISTS "requiresAction" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "escalationLevel" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "NotificationInboxItem_userId_groupKey_createdAt_idx"
  ON "NotificationInboxItem"("userId", "groupKey", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationInboxItem_userId_tool_createdAt_idx"
  ON "NotificationInboxItem"("userId", "tool", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationInboxItem_userId_signal_createdAt_idx"
  ON "NotificationInboxItem"("userId", "signal", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationInboxItem_userId_requiresAction_readAt_createdAt_idx"
  ON "NotificationInboxItem"("userId", "requiresAction", "readAt", "createdAt");
