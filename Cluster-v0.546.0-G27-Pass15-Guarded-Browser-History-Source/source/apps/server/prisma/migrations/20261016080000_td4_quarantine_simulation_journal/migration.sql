-- R67: immutable simulation evidence only, with NO provider mutation authority.
CREATE TABLE "LibraryQuarantinePlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "planKey" TEXT NOT NULL,
  "planVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshotSha256" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "decisionRevision" INTEGER NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryQuarantinePlan_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LibraryDispositionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LibraryQuarantinePlan_version_check" CHECK ("planVersion" > 0),
  CONSTRAINT "LibraryQuarantinePlan_fingerprint_check" CHECK (length("snapshotSha256") = 64)
);
CREATE UNIQUE INDEX "LibraryQuarantinePlan_planKey_key" ON "LibraryQuarantinePlan"("planKey");
CREATE INDEX "LibraryQuarantinePlan_requestId_recordedAt_idx" ON "LibraryQuarantinePlan"("requestId", "recordedAt");
CREATE INDEX "LibraryQuarantinePlan_itemId_recordedAt_idx" ON "LibraryQuarantinePlan"("itemId", "recordedAt");
CREATE TABLE "LibraryQuarantineJournal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "detailsJson" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryQuarantineJournal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "LibraryQuarantinePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LibraryQuarantineJournal_event_check" CHECK ("eventType" IN ('SIMULATED','WITHDRAWN'))
);
CREATE INDEX "LibraryQuarantineJournal_planId_occurredAt_idx" ON "LibraryQuarantineJournal"("planId", "occurredAt");
CREATE UNIQUE INDEX "LibraryQuarantineJournal_one_withdrawal" ON "LibraryQuarantineJournal"("planId") WHERE "eventType" = 'WITHDRAWN';
-- Deliberate append-only DB evidence: neither the plan nor journal can be
-- rewritten or purged by normal application code.
CREATE TRIGGER "LibraryQuarantinePlan_immutable" BEFORE UPDATE OR DELETE ON "LibraryQuarantinePlan"
  FOR EACH ROW EXECUTE FUNCTION "cluster_library_disposition_evidence_immutable"();
CREATE TRIGGER "LibraryQuarantineJournal_immutable" BEFORE UPDATE OR DELETE ON "LibraryQuarantineJournal"
  FOR EACH ROW EXECUTE FUNCTION "cluster_library_disposition_evidence_immutable"();
