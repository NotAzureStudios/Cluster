-- Detached Packet derivative issuance evidence; never authorizes Library sources.
CREATE TABLE "PacketDeliveryReceipt" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER,
    "derivativeHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PacketDeliveryReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PacketDeliveryReceipt_releaseId_issuedAt_id_idx" ON "PacketDeliveryReceipt"("releaseId", "issuedAt", "id");
CREATE INDEX "PacketDeliveryReceipt_recipientId_issuedAt_idx" ON "PacketDeliveryReceipt"("recipientId", "issuedAt");
ALTER TABLE "PacketDeliveryReceipt" ADD CONSTRAINT "PacketDeliveryReceipt_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "PacketRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
