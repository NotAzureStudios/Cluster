CREATE TABLE "CardSavedOperation" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "fields" TEXT NOT NULL DEFAULT '[]',
  "before" TEXT NOT NULL DEFAULT '{}',
  "after" TEXT NOT NULL DEFAULT '{}',
  "appliedRevision" INTEGER NOT NULL,
  "sourceOperationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardSavedOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CardSavedOperation_cardId_appliedRevision_key" ON "CardSavedOperation"("cardId", "appliedRevision");
CREATE INDEX "CardSavedOperation_cardId_createdAt_idx" ON "CardSavedOperation"("cardId", "createdAt");
CREATE INDEX "CardSavedOperation_actorUserId_createdAt_idx" ON "CardSavedOperation"("actorUserId", "createdAt");
ALTER TABLE "CardSavedOperation" ADD CONSTRAINT "CardSavedOperation_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
