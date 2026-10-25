-- Phase 10 RC17 WIP10: align AccessRule indexes with authorization hot-path lookups.
CREATE INDEX IF NOT EXISTS "AccessRule_targetKind_targetId_status_idx"
  ON "AccessRule"("targetKind", "targetId", "status");

CREATE INDEX IF NOT EXISTS "AccessRule_projectId_status_idx"
  ON "AccessRule"("projectId", "status");
