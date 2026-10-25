-- Durable, revision-scoped Board List metadata edits.
CREATE TABLE "BoardListSavedOperation" (
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "fields" TEXT NOT NULL DEFAULT '[]',
  "before" TEXT NOT NULL DEFAULT '{}',
  "after" TEXT NOT NULL DEFAULT '{}',
  "appliedRevision" INTEGER NOT NULL,
  "sourceOperationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoardListSavedOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BoardListSavedOperation_listId_appliedRevision_key" ON "BoardListSavedOperation"("listId", "appliedRevision");
CREATE INDEX "BoardListSavedOperation_listId_createdAt_idx" ON "BoardListSavedOperation"("listId", "createdAt");
CREATE INDEX "BoardListSavedOperation_actorUserId_createdAt_idx" ON "BoardListSavedOperation"("actorUserId", "createdAt");
ALTER TABLE "BoardListSavedOperation" ADD CONSTRAINT "BoardListSavedOperation_listId_fkey" FOREIGN KEY ("listId") REFERENCES "BoardList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
