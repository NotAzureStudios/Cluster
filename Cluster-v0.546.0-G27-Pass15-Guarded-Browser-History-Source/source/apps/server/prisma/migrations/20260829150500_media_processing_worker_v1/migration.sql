CREATE TABLE "MediaArtifact" (
  "id" TEXT NOT NULL,
  "videoAssetId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "checksumSha256" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaArtifact_videoAssetId_kind_key" ON "MediaArtifact"("videoAssetId", "kind");
CREATE INDEX "MediaArtifact_kind_updatedAt_idx" ON "MediaArtifact"("kind", "updatedAt");
ALTER TABLE "MediaArtifact" ADD CONSTRAINT "MediaArtifact_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "VideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MediaWorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "pid" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "capabilities" TEXT NOT NULL DEFAULT '[]',
  "ffmpegVersion" TEXT,
  "ffprobeVersion" TEXT,
  "concurrency" INTEGER NOT NULL DEFAULT 1,
  "activeJobs" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MediaWorkerHeartbeat_status_lastSeenAt_idx" ON "MediaWorkerHeartbeat"("status", "lastSeenAt");
