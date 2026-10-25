CREATE TABLE "StudioAccessRenewal" (
 "id" TEXT NOT NULL, "subjectUserId" TEXT NOT NULL, "requestedById" TEXT NOT NULL,
 "reviewedById" TEXT, "status" TEXT NOT NULL DEFAULT 'pending',
 "requestedExpiresAt" TIMESTAMP(3) NOT NULL, "previousExpiresAt" TIMESTAMP(3) NOT NULL,
 "expectedProfileRevision" INTEGER NOT NULL, "reason" TEXT NOT NULL, "reviewReason" TEXT,
 "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3), "personnelRecordId" TEXT,
 CONSTRAINT "StudioAccessRenewal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudioAccessRenewal_subjectUserId_status_requestedAt_idx" ON "StudioAccessRenewal"("subjectUserId", "status", "requestedAt");
CREATE INDEX "StudioAccessRenewal_status_requestedAt_idx" ON "StudioAccessRenewal"("status", "requestedAt");
ALTER TABLE "StudioAccessRenewal" ADD CONSTRAINT "StudioAccessRenewal_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioAccessRenewal" ADD CONSTRAINT "StudioAccessRenewal_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioAccessRenewal" ADD CONSTRAINT "StudioAccessRenewal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "StudioAccessExpiryNotice" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "stage" TEXT NOT NULL, "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StudioAccessExpiryNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioAccessExpiryNotice_userId_expiresAt_stage_key" ON "StudioAccessExpiryNotice"("userId", "expiresAt", "stage");
CREATE INDEX "StudioAccessExpiryNotice_stage_notifiedAt_idx" ON "StudioAccessExpiryNotice"("stage", "notifiedAt");
ALTER TABLE "StudioAccessExpiryNotice" ADD CONSTRAINT "StudioAccessExpiryNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
