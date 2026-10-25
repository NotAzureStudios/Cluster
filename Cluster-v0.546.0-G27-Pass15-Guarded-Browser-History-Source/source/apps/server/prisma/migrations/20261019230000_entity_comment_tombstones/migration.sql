-- Preserve discussion roots and replies after deletion; never expose deleted text.
ALTER TABLE "EntityComment" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Stable keyset indexes avoid deep OFFSET scans and per-thread full-table reads.
CREATE INDEX "EntityComment_thread_page_idx" ON "EntityComment"("entityType", "entityId", "parentCommentId", "pinned", "createdAt", "id");
CREATE INDEX "EntityComment_reply_page_idx" ON "EntityComment"("entityType", "entityId", "threadRootId", "parentCommentId", "createdAt", "id");
