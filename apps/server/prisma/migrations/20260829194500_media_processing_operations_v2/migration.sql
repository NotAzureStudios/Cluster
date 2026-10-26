ALTER TABLE "MediaWorkerHeartbeat"
  ADD COLUMN "labels" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "accelerationProfiles" TEXT NOT NULL DEFAULT '["software"]',
  ADD COLUMN "selectedAcceleration" TEXT NOT NULL DEFAULT 'software',
  ADD COLUMN "desiredState" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "storageTopology" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN "storageFingerprint" TEXT,
  ADD COLUMN "lastError" TEXT;

CREATE INDEX "MediaWorkerHeartbeat_desiredState_lastSeenAt_idx" ON "MediaWorkerHeartbeat"("desiredState", "lastSeenAt");
CREATE INDEX "MediaWorkerHeartbeat_selectedAcceleration_status_idx" ON "MediaWorkerHeartbeat"("selectedAcceleration", "status");

CREATE TABLE "MediaProcessingPolicy" (
  "id" TEXT NOT NULL,
  "projectType" TEXT NOT NULL,
  "assetRole" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "jobs" TEXT NOT NULL DEFAULT '[]',
  "accelerationPreference" TEXT NOT NULL DEFAULT 'auto',
  "retentionDays" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaProcessingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaProcessingPolicy_projectType_assetRole_key" ON "MediaProcessingPolicy"("projectType", "assetRole");
CREATE INDEX "MediaProcessingPolicy_enabled_projectType_idx" ON "MediaProcessingPolicy"("enabled", "projectType");
