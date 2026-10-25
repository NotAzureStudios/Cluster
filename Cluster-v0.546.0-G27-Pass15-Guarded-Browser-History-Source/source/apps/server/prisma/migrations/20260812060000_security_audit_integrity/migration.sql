ALTER TABLE "SecurityAuditEvent"
  ADD COLUMN "requestMethod" TEXT,
  ADD COLUMN "requestPath" TEXT,
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "integrityVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "eventHash" TEXT;

CREATE INDEX "SecurityAuditEvent_integrityVersion_sequence_idx" ON "SecurityAuditEvent"("integrityVersion", "sequence");
CREATE INDEX "SecurityAuditEvent_requestId_idx" ON "SecurityAuditEvent"("requestId");
CREATE UNIQUE INDEX "SecurityAuditEvent_v1_sequence_key"
  ON "SecurityAuditEvent"("sequence")
  WHERE "integrityVersion" = 1 AND "sequence" IS NOT NULL;
CREATE UNIQUE INDEX "SecurityAuditEvent_eventHash_key"
  ON "SecurityAuditEvent"("eventHash")
  WHERE "eventHash" IS NOT NULL;
