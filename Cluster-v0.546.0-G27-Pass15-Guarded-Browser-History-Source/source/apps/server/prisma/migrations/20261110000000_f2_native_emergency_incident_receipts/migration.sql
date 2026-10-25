-- F2 P4: crash-safe, idempotent native supervisor journal reconciliation.
-- The supervisor's journal remains on disk and is never deleted by the API.
CREATE TABLE "OperationsNativeAlertReceipt" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL,
  "category" TEXT NOT NULL, "incidentId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "occurredAtOrdinal" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcome" TEXT NOT NULL,
  CONSTRAINT "OperationsNativeAlertReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OperationsNativeAlertReceipt_category_occurredAtOrdinal_id_idx"
  ON "OperationsNativeAlertReceipt"("category", "occurredAtOrdinal", "id");
CREATE INDEX "OperationsNativeAlertReceipt_processedAt_idx"
  ON "OperationsNativeAlertReceipt"("processedAt");
