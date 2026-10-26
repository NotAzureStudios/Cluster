CREATE TABLE "DataRetentionPolicy" (
  "category" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "retentionDays" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("category")
);

CREATE INDEX "DataRetentionPolicy_enabled_retentionDays_idx" ON "DataRetentionPolicy"("enabled", "retentionDays");
CREATE INDEX "DataRetentionPolicy_updatedAt_idx" ON "DataRetentionPolicy"("updatedAt");

CREATE TABLE "DataRetentionRun" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "actorUserId" TEXT,
  "status" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "resultJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "DataRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataRetentionRun_createdAt_idx" ON "DataRetentionRun"("createdAt");
CREATE INDEX "DataRetentionRun_status_createdAt_idx" ON "DataRetentionRun"("status", "createdAt");
CREATE INDEX "DataRetentionRun_actorUserId_createdAt_idx" ON "DataRetentionRun"("actorUserId", "createdAt");
