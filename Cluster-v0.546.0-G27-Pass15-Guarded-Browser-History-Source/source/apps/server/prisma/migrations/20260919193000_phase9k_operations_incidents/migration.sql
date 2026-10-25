CREATE TABLE "OperationsIncident" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'open',
  "ownerUserId" TEXT,
  "correlationId" TEXT,
  "openedById" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationsIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationsIncidentResource" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationsIncidentResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationsIncidentTimeline" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "actorUserId" TEXT,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationsIncidentTimeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationsIncident_status_severity_updatedAt_idx" ON "OperationsIncident"("status", "severity", "updatedAt");
CREATE INDEX "OperationsIncident_ownerUserId_status_updatedAt_idx" ON "OperationsIncident"("ownerUserId", "status", "updatedAt");
CREATE INDEX "OperationsIncident_correlationId_updatedAt_idx" ON "OperationsIncident"("correlationId", "updatedAt");
CREATE INDEX "OperationsIncident_openedAt_idx" ON "OperationsIncident"("openedAt");
CREATE UNIQUE INDEX "OperationsIncidentResource_incidentId_kind_resourceId_key" ON "OperationsIncidentResource"("incidentId", "kind", "resourceId");
CREATE INDEX "OperationsIncidentResource_kind_resourceId_idx" ON "OperationsIncidentResource"("kind", "resourceId");
CREATE INDEX "OperationsIncidentTimeline_incidentId_createdAt_idx" ON "OperationsIncidentTimeline"("incidentId", "createdAt");
CREATE INDEX "OperationsIncidentTimeline_correlationId_createdAt_idx" ON "OperationsIncidentTimeline"("correlationId", "createdAt");

ALTER TABLE "OperationsIncidentResource" ADD CONSTRAINT "OperationsIncidentResource_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "OperationsIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationsIncidentTimeline" ADD CONSTRAINT "OperationsIncidentTimeline_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "OperationsIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
