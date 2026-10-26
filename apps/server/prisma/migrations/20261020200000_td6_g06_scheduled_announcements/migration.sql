-- G06: scheduled Studio announcements have explicit lifecycle and optimistic revisions.
ALTER TABLE "StudioAnnouncement"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "StudioAnnouncement_status_scheduledAt_idx" ON "StudioAnnouncement"("status", "scheduledAt");
