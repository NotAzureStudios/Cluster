-- Studio configuration import publication history. Only allowlisted studio defaults.
CREATE TABLE "StudioConfigurationRevision" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "requestedJson" TEXT NOT NULL,
    "changesJson" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioConfigurationRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudioConfigurationRevision_createdAt_idx" ON "StudioConfigurationRevision"("createdAt");
CREATE INDEX "StudioConfigurationRevision_actorUserId_createdAt_idx" ON "StudioConfigurationRevision"("actorUserId", "createdAt");
