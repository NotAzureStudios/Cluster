-- F3: optional unique source key for confirmed automated dependency incidents.
-- Existing human-created incidents retain NULL automationKey and remain unaffected.
ALTER TABLE "OperationsIncident" ADD COLUMN "automationKey" TEXT;
CREATE UNIQUE INDEX "OperationsIncident_automationKey_key" ON "OperationsIncident"("automationKey");
