CREATE INDEX "BackgroundJob_workspaceId_status_leaseExpiresAt_idx"
  ON "BackgroundJob"("workspaceId", "status", "leaseExpiresAt");
