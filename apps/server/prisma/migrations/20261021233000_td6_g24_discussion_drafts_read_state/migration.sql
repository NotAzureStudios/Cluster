-- TD6 G24: access-checked private drafts and monotonic per-user read watermarks.
CREATE TABLE "EntityCommentDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EntityCommentDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntityCommentDraft_identity_key" ON "EntityCommentDraft"("userId", "entityType", "entityId", "slotKey");
CREATE INDEX "EntityCommentDraft_userId_updatedAt_idx" ON "EntityCommentDraft"("userId", "updatedAt");
ALTER TABLE "EntityCommentDraft" ADD CONSTRAINT "EntityCommentDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EntityCommentReadState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EntityCommentReadState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntityCommentReadState_identity_key" ON "EntityCommentReadState"("userId", "entityType", "entityId");
CREATE INDEX "EntityCommentReadState_userId_lastReadAt_idx" ON "EntityCommentReadState"("userId", "lastReadAt");
ALTER TABLE "EntityCommentReadState" ADD CONSTRAINT "EntityCommentReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
