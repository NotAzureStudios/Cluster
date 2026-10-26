-- Explicit, release-bound Packet reminder evidence. No automatic cascade of audit records.
CREATE TABLE "PacketReleaseReminderDelivery" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PacketReleaseReminderDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PacketReleaseReminderDelivery_requirementId_sentAt_idx" ON "PacketReleaseReminderDelivery"("requirementId", "sentAt");
CREATE INDEX "PacketReleaseReminderDelivery_recipientId_sentAt_idx" ON "PacketReleaseReminderDelivery"("recipientId", "sentAt");
CREATE INDEX "PacketReleaseReminderDelivery_releaseId_sentAt_idx" ON "PacketReleaseReminderDelivery"("releaseId", "sentAt");
ALTER TABLE "PacketReleaseReminderDelivery" ADD CONSTRAINT "PacketReleaseReminderDelivery_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PacketReleaseRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PacketReleaseReminderDelivery" ADD CONSTRAINT "PacketReleaseReminderDelivery_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PacketRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
