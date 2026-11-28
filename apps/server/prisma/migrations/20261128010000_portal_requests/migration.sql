ALTER TABLE "StudioAnnouncement" ADD COLUMN "channels" TEXT NOT NULL DEFAULT 'studio';

CREATE TABLE "PortalRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'player',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "projectId" TEXT,
    "cardId" TEXT,
    "submissionId" TEXT,
    "requesterUserId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortalRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortalRequest_code_key" ON "PortalRequest"("code");
CREATE UNIQUE INDEX "PortalRequest_submissionId_key" ON "PortalRequest"("submissionId");
CREATE INDEX "PortalRequest_audience_status_lastActivityAt_idx" ON "PortalRequest"("audience", "status", "lastActivityAt");
CREATE INDEX "PortalRequest_requesterUserId_lastActivityAt_idx" ON "PortalRequest"("requesterUserId", "lastActivityAt");

CREATE TABLE "PortalRequestMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalRequestMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PortalRequestMessage_requestId_createdAt_idx" ON "PortalRequestMessage"("requestId", "createdAt");
ALTER TABLE "PortalRequestMessage" ADD CONSTRAINT "PortalRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PortalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
