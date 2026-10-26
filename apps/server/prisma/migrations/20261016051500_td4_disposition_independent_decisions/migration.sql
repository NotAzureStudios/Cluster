-- R66: independent governance review, not storage authorization.
ALTER TABLE "LibraryDispositionRequest" ADD COLUMN "decisionRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LibraryDispositionRequest" ADD COLUMN "snapshotVersion" INTEGER NOT NULL DEFAULT 1;
-- An approved review remains active: a second disposition cannot be opened
-- while its governance decision is in force.
DROP INDEX "LibraryDispositionRequest_one_pending_per_item";
CREATE UNIQUE INDEX "LibraryDispositionRequest_one_active_per_item"
  ON "LibraryDispositionRequest"("itemId")
  WHERE "status" IN ('PENDING_REVIEW', 'REVIEW_APPROVED');
CREATE TABLE "LibraryDispositionDecision" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotSha256" TEXT NOT NULL,
  "requestDecisionRevision" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryDispositionDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryDispositionDecision_action_check" CHECK ("action" IN ('APPROVE', 'REVOKE', 'REJECT')),
  CONSTRAINT "LibraryDispositionDecision_snapshot_version_check" CHECK ("snapshotVersion" > 0),
  CONSTRAINT "LibraryDispositionDecision_revision_check" CHECK ("requestDecisionRevision" > 0)
);
ALTER TABLE "LibraryDispositionDecision" ADD CONSTRAINT "LibraryDispositionDecision_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LibraryDispositionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "LibraryDispositionDecision_requestId_requestDecisionRevision_key"
  ON "LibraryDispositionDecision"("requestId", "requestDecisionRevision");
CREATE INDEX "LibraryDispositionDecision_requestId_occurredAt_idx"
  ON "LibraryDispositionDecision"("requestId", "occurredAt");
CREATE INDEX "LibraryDispositionDecision_actorId_occurredAt_idx"
  ON "LibraryDispositionDecision"("actorId", "occurredAt");
-- Decision records are evidence, not editable state. The request status and
-- decisionRevision are the only materialized mutable decision projection.
CREATE TRIGGER "LibraryDispositionDecision_immutable"
  BEFORE UPDATE OR DELETE ON "LibraryDispositionDecision"
  FOR EACH ROW EXECUTE FUNCTION "cluster_library_disposition_evidence_immutable"();
