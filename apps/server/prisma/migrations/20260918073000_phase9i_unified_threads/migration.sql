ALTER TABLE "EntityComment"
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedById" TEXT,
  ADD COLUMN "assigneeId" TEXT,
  ADD COLUMN "parentCommentId" TEXT,
  ADD COLUMN "threadRootId" TEXT,
  ADD COLUMN "mentionedUserIds" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "reactions" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "evidenceLinks" TEXT NOT NULL DEFAULT '[]';

CREATE INDEX "EntityComment_entityType_entityId_threadRootId_createdAt_idx" ON "EntityComment"("entityType", "entityId", "threadRootId", "createdAt");
CREATE INDEX "EntityComment_parentCommentId_createdAt_idx" ON "EntityComment"("parentCommentId", "createdAt");
CREATE INDEX "EntityComment_assigneeId_resolved_updatedAt_idx" ON "EntityComment"("assigneeId", "resolved", "updatedAt");
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "EntityComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "EntityComment" SET "threadRootId" = "id" WHERE "threadRootId" IS NULL;
