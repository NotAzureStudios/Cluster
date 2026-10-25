-- Staged disposition is not physical deletion. No cascading relationship to
-- LibraryItem permits audit evidence to survive future authorized retirement.
CREATE TABLE "LibraryDispositionRequest" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewAfter" TIMESTAMP(3) NOT NULL,
  "originalRevision" INTEGER NOT NULL,
  "snapshotSha256" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  CONSTRAINT "LibraryDispositionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LibraryDispositionRequest_itemId_status_requestedAt_idx" ON "LibraryDispositionRequest"("itemId", "status", "requestedAt");
CREATE UNIQUE INDEX "LibraryDispositionRequest_one_pending_per_item" ON "LibraryDispositionRequest"("itemId") WHERE "status" = 'PENDING_REVIEW';
CREATE UNIQUE INDEX "LibraryDispositionRequest_requestKey_key" ON "LibraryDispositionRequest"("requestKey");
CREATE INDEX "LibraryDispositionRequest_status_reviewAfter_idx" ON "LibraryDispositionRequest"("status", "reviewAfter");
CREATE INDEX "LibraryDispositionRequest_requestedById_requestedAt_idx" ON "LibraryDispositionRequest"("requestedById", "requestedAt");
CREATE TABLE "LibraryDispositionEvidence" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detailsJson" TEXT NOT NULL,
  CONSTRAINT "LibraryDispositionEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LibraryDispositionEvidence_requestId_occurredAt_idx" ON "LibraryDispositionEvidence"("requestId", "occurredAt");
ALTER TABLE "LibraryDispositionEvidence" ADD CONSTRAINT "LibraryDispositionEvidence_requestId_fkey"
 FOREIGN KEY ("requestId") REFERENCES "LibraryDispositionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidentiary records are append-only even if an application code path later
-- tries to update/delete them. Requests may transition PENDING_REVIEW to
-- CANCELLED; the individual evidence events never change.
CREATE FUNCTION "cluster_library_disposition_evidence_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Library disposition evidence is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LibraryDispositionEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "LibraryDispositionEvidence"
  FOR EACH ROW EXECUTE FUNCTION "cluster_library_disposition_evidence_immutable"();
