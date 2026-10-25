-- Block 29H: media-independent review threads and mention references.
ALTER TABLE "ReviewComment" ADD COLUMN "parentCommentId" TEXT;
ALTER TABLE "ReviewComment" ADD COLUMN "threadRootId" TEXT;
ALTER TABLE "ReviewComment" ADD COLUMN "mentionedUserIds" TEXT NOT NULL DEFAULT '[]';

CREATE INDEX "ReviewComment_reviewAssetId_threadRootId_createdAt_idx" ON "ReviewComment"("reviewAssetId", "threadRootId", "createdAt");
CREATE INDEX "ReviewComment_parentCommentId_createdAt_idx" ON "ReviewComment"("parentCommentId", "createdAt");

ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "ReviewComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
