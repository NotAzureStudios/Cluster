-- Retain immutable Packet source manifests and derivative bytes as evidence,
-- but immediately block recipient delivery after an explicit revocation.
ALTER TABLE "PacketRelease"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "revocationReason" TEXT;
CREATE INDEX "PacketRelease_packetDefinitionId_revokedAt_idx"
  ON "PacketRelease"("packetDefinitionId", "revokedAt");
