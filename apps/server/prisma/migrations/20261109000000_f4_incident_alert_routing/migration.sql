-- F4: durable, policy-routed server incident acknowledgement and alert receipts.
ALTER TABLE "OperationsIncident" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "OperationsIncident" ADD COLUMN "acknowledgedById" TEXT;
ALTER TABLE "OperationsIncident" ADD COLUMN "alertCycle" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "OperationsAlertPolicy" (
  "key" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "recipientType" TEXT NOT NULL DEFAULT 'admins', "recipientId" TEXT,
  "escalationType" TEXT NOT NULL DEFAULT 'admins', "escalationId" TEXT,
  "acknowledgeMinutes" INTEGER NOT NULL DEFAULT 15,
  "reminderMinutes" INTEGER NOT NULL DEFAULT 10,
  "revision" INTEGER NOT NULL DEFAULT 1, "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationsAlertPolicy_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "OperationsIncidentAlertDispatch" (
  "id" TEXT NOT NULL, "incidentId" TEXT NOT NULL,
  "cycle" INTEGER NOT NULL, "stage" TEXT NOT NULL,
  "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationsIncidentAlertDispatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationsIncidentAlertDispatch_incidentId_cycle_stage_userId_key"
  ON "OperationsIncidentAlertDispatch"("incidentId", "cycle", "stage", "userId");
CREATE INDEX "OperationsIncidentAlertDispatch_createdAt_idx" ON "OperationsIncidentAlertDispatch"("createdAt");
ALTER TABLE "OperationsIncidentAlertDispatch" ADD CONSTRAINT "OperationsIncidentAlertDispatch_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "OperationsIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
