-- Indexes for foreign keys that queries filter or join on but that had no
-- index leading with the column (PostgreSQL does not create these automatically).

CREATE INDEX IF NOT EXISTS "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX IF NOT EXISTS "ChecklistItem_cardId_idx" ON "ChecklistItem"("cardId");
CREATE INDEX IF NOT EXISTS "CardActivity_cardId_idx" ON "CardActivity"("cardId");
CREATE INDEX IF NOT EXISTS "ScheduleBlock_cardId_idx" ON "ScheduleBlock"("cardId");
CREATE INDEX IF NOT EXISTS "ScheduleBlock_boardId_idx" ON "ScheduleBlock"("boardId");
CREATE INDEX IF NOT EXISTS "ActivityEvent_boardId_idx" ON "ActivityEvent"("boardId");
CREATE INDEX IF NOT EXISTS "ActivityEvent_whiteboardId_idx" ON "ActivityEvent"("whiteboardId");
CREATE INDEX IF NOT EXISTS "SecurityAuditEvent_actorUserId_idx" ON "SecurityAuditEvent"("actorUserId");
CREATE INDEX IF NOT EXISTS "ReviewComment_userId_idx" ON "ReviewComment"("userId");
CREATE INDEX IF NOT EXISTS "ReviewAsset_ownerId_idx" ON "ReviewAsset"("ownerId");
CREATE INDEX IF NOT EXISTS "StudioFormSubmission_formVersionId_idx" ON "StudioFormSubmission"("formVersionId");
CREATE INDEX IF NOT EXISTS "StudioFormResponseDraft_formVersionId_idx" ON "StudioFormResponseDraft"("formVersionId");
CREATE INDEX IF NOT EXISTS "ManagedPackagePin_releaseId_idx" ON "ManagedPackagePin"("releaseId");
CREATE INDEX IF NOT EXISTS "ManagedPackageRollout_releaseId_idx" ON "ManagedPackageRollout"("releaseId");
CREATE INDEX IF NOT EXISTS "VersionPolicy_projectId_idx" ON "VersionPolicy"("projectId");
