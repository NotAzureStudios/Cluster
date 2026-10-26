ALTER TABLE "StudioFormSubmission"
  ADD COLUMN "submissionSource" TEXT NOT NULL DEFAULT 'authenticated',
  ADD COLUMN "privacyConsentAt" TIMESTAMP(3),
  ADD COLUMN "convertedUserId" TEXT,
  ADD COLUMN "convertedAt" TIMESTAMP(3),
  ADD COLUMN "conversionJson" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "StudioFormSubmission_convertedUserId_convertedAt_idx" ON "StudioFormSubmission"("convertedUserId", "convertedAt");
ALTER TABLE "StudioFormSubmission" ADD CONSTRAINT "StudioFormSubmission_convertedUserId_fkey" FOREIGN KEY ("convertedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StudioAnnouncement" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audienceJson" TEXT NOT NULL DEFAULT '{"mode":"all","targets":[]}',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdById" TEXT,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMP(3),
  "deliveryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudioAnnouncement_status_publishedAt_idx" ON "StudioAnnouncement"("status", "publishedAt");
CREATE INDEX "StudioAnnouncement_priority_publishedAt_idx" ON "StudioAnnouncement"("priority", "publishedAt");
ALTER TABLE "StudioAnnouncement" ADD CONSTRAINT "StudioAnnouncement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudioAnnouncement" ADD CONSTRAINT "StudioAnnouncement_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
