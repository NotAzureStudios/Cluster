-- Private, per-user thread-level read state. Root identity remains stable
-- after comment tombstoning and is authorized through the parent resource.
CREATE TABLE "EntityCommentThreadReadState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "threadRootId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EntityCommentThreadReadState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntityCommentThreadReadState_identity_key" ON "EntityCommentThreadReadState"("userId", "entityType", "entityId", "threadRootId");
CREATE INDEX "EntityCommentThreadReadState_userId_updatedAt_idx" ON "EntityCommentThreadReadState"("userId", "updatedAt");
ALTER TABLE "EntityCommentThreadReadState" ADD CONSTRAINT "EntityCommentThreadReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
