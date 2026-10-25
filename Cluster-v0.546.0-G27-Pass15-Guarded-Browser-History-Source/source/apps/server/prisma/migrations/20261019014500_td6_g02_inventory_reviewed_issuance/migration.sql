CREATE TABLE "StudioInventoryAccessRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "operation" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "expectedRevision" INTEGER NOT NULL,
  "expectedProfileRevision" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "resultId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "StudioInventoryAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudioInventoryAccessRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudioInventoryAccessRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "StudioInventoryAccessRequest_status_requestedAt_idx" ON "StudioInventoryAccessRequest"("status", "requestedAt");
CREATE INDEX "StudioInventoryAccessRequest_operation_targetId_userId_status_idx" ON "StudioInventoryAccessRequest"("operation", "targetId", "userId", "status");
CREATE INDEX "StudioInventoryAccessRequest_userId_requestedAt_idx" ON "StudioInventoryAccessRequest"("userId", "requestedAt");
-- Request insertion first locks the governing asset or key-pool row. These
-- indexes additionally prevent concurrent pending issuance outside that route.
CREATE UNIQUE INDEX "StudioInventoryAccessRequest_pending_subject_unique" ON "StudioInventoryAccessRequest"("operation", "targetId", "userId") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "StudioInventoryAccessRequest_pending_key_unique" ON "StudioInventoryAccessRequest"("targetId") WHERE "status" = 'pending' AND "operation" = 'key_issue';
