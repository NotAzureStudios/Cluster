-- Human acknowledgment of a specific immutable publication. Independent from
-- server-issued download receipts and mutable PacketDefinition completion.
CREATE TABLE "PacketReleaseAcknowledgment" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "versionLabel" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PacketReleaseAcknowledgment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PacketReleaseAcknowledgment_releaseId_recipientId_key" ON "PacketReleaseAcknowledgment"("releaseId", "recipientId");
CREATE INDEX "PacketReleaseAcknowledgment_releaseId_acknowledgedAt_id_idx" ON "PacketReleaseAcknowledgment"("releaseId", "acknowledgedAt", "id");
CREATE INDEX "PacketReleaseAcknowledgment_recipientId_acknowledgedAt_idx" ON "PacketReleaseAcknowledgment"("recipientId", "acknowledgedAt");
ALTER TABLE "PacketReleaseAcknowledgment" ADD CONSTRAINT "PacketReleaseAcknowledgment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PacketRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
