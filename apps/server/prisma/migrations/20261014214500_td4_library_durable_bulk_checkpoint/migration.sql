-- Transactional checkpoint for non-destructive Library background bulk mutations.
CREATE TABLE "LibraryBulkCheckpoint" (
  "jobId" TEXT NOT NULL PRIMARY KEY,
  "nextIndex" INTEGER NOT NULL DEFAULT 0,
  "changed" INTEGER NOT NULL DEFAULT 0,
  "conflicted" INTEGER NOT NULL DEFAULT 0,
  "denied" INTEGER NOT NULL DEFAULT 0,
  "blocked" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryBulkCheckpoint_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryBulkCheckpoint_counts_nonnegative" CHECK ("nextIndex" >= 0 AND "changed" >= 0 AND "conflicted" >= 0 AND "denied" >= 0 AND "blocked" >= 0 AND "skipped" >= 0)
);

-- One intent, one operation even after successful completion and across
-- concurrent requests. Other job types retain their existing dedupe semantics.
CREATE UNIQUE INDEX "BackgroundJob_library_bulk_intent_once_idx"
  ON "BackgroundJob"("type", "createdById", "dedupeKey")
  WHERE "type" = 'library.bulk.metadata' AND "dedupeKey" IS NOT NULL;
