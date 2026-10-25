-- TD6 F08: preserve offboarding evidence while permitting exactly one governed return
-- for each completed offboarding case. Account state remains disabled after return.
ALTER TABLE "StudioOffboardingCase"
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnedById" TEXT,
  ADD COLUMN "returnReason" TEXT,
  ADD COLUMN "returnPersonnelRecordId" TEXT;
ALTER TABLE "StudioOffboardingCase"
  ADD CONSTRAINT "StudioOffboardingCase_returnedById_fkey"
  FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StudioOffboardingCase_subjectUserId_returnedAt_idx"
  ON "StudioOffboardingCase"("subjectUserId", "returnedAt");
ALTER TABLE "StudioOffboardingCase"
  ADD CONSTRAINT "StudioOffboardingCase_returnPersonnelRecordId_fkey"
  FOREIGN KEY ("returnPersonnelRecordId") REFERENCES "PersonnelRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "StudioOffboardingCase_returnPersonnelRecordId_key"
  ON "StudioOffboardingCase"("returnPersonnelRecordId");
