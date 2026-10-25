ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "deferredUntil" TIMESTAMP(3);
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stateEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "completionCriteria" TEXT;

CREATE INDEX IF NOT EXISTS "Card_archived_deferredUntil_idx" ON "Card"("archived", "deferredUntil");
CREATE INDEX IF NOT EXISTS "Card_listId_stateEnteredAt_idx" ON "Card"("listId", "stateEnteredAt");
