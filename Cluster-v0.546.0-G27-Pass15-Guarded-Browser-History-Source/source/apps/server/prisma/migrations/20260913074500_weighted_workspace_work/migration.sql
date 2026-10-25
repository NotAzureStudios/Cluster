ALTER TABLE "BackgroundJob"
  ADD COLUMN "costUnits" INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS "BackgroundJob_workspaceId_status_leaseExpiresAt_idx";
CREATE INDEX "BackgroundJob_workspaceId_status_leaseExpiresAt_costUnits_idx"
  ON "BackgroundJob"("workspaceId", "status", "leaseExpiresAt", "costUnits");
