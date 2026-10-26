ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstLoginCompletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "User_firstLoginCompletedAt_accountState_idx" ON "User"("firstLoginCompletedAt", "accountState");
