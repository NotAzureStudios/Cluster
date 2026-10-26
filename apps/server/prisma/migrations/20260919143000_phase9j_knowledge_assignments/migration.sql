ALTER TABLE "PacketDefinition" ADD COLUMN "recertifyDays" INTEGER;
ALTER TABLE "PacketDefinition" ADD COLUMN "recordCompletion" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PacketCompletion" ADD COLUMN "packetVersionLabel" TEXT NOT NULL DEFAULT '1.0';
UPDATE "PacketCompletion" AS pc SET "packetVersionLabel" = pd."versionLabel" FROM "PacketDefinition" AS pd WHERE pc."packetDefinitionId" = pd."id";
ALTER TABLE "PacketCompletion" ADD COLUMN "validUntil" TIMESTAMP(3);
DROP INDEX IF EXISTS "PacketCompletion_packetDefinitionId_userId_key";
CREATE INDEX "PacketCompletion_packetDefinitionId_userId_completedAt_idx" ON "PacketCompletion"("packetDefinitionId", "userId", "completedAt");

ALTER TABLE "StudioPolicy" ADD COLUMN "recordAcceptance" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PersonnelRecord" ADD COLUMN "sourceKind" TEXT;
ALTER TABLE "PersonnelRecord" ADD COLUMN "sourceId" TEXT;
CREATE UNIQUE INDEX "PersonnelRecord_sourceKind_sourceId_key" ON "PersonnelRecord"("sourceKind", "sourceId");

CREATE TABLE "StudioKnowledgeAssignment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "resourceKind" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resourceVersionId" TEXT,
  "versionKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'active',
  "source" TEXT NOT NULL DEFAULT 'audience',
  "cycleStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3),
  "satisfiedAt" TIMESTAMP(3),
  "nextRequiredAt" TIMESTAMP(3),
  "evidenceId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioKnowledgeAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioKnowledgeAssignment_userId_resourceKind_resourceId_key" ON "StudioKnowledgeAssignment"("userId", "resourceKind", "resourceId");
CREATE INDEX "StudioKnowledgeAssignment_userId_state_dueAt_idx" ON "StudioKnowledgeAssignment"("userId", "state", "dueAt");
CREATE INDEX "StudioKnowledgeAssignment_resourceKind_resourceId_state_idx" ON "StudioKnowledgeAssignment"("resourceKind", "resourceId", "state");
CREATE INDEX "StudioKnowledgeAssignment_nextRequiredAt_state_idx" ON "StudioKnowledgeAssignment"("nextRequiredAt", "state");
ALTER TABLE "StudioKnowledgeAssignment" ADD CONSTRAINT "StudioKnowledgeAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
