-- A unique creator/intent pair makes ambiguous announcement-create retries durable.
-- Nullable keys preserve pre-existing announcements; PostgreSQL permits multiple NULL intents.
ALTER TABLE "StudioAnnouncement"
  ADD COLUMN "createIntentId" TEXT,
  ADD COLUMN "createPayloadSha256" TEXT;
CREATE UNIQUE INDEX "StudioAnnouncement_createdById_createIntentId_key"
  ON "StudioAnnouncement"("createdById", "createIntentId");
