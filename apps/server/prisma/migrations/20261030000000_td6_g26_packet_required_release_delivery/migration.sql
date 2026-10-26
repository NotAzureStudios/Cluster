-- Required acknowledgment assignments reference the exact immutable Packet release.
CREATE TABLE "PacketReleaseRequirement" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PacketReleaseRequirement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PacketReleaseRequirement_releaseId_recipientId_key" ON "PacketReleaseRequirement"("releaseId", "recipientId");
CREATE INDEX "PacketReleaseRequirement_recipientId_dueAt_idx" ON "PacketReleaseRequirement"("recipientId", "dueAt");
CREATE INDEX "PacketReleaseRequirement_releaseId_assignedAt_id_idx" ON "PacketReleaseRequirement"("releaseId", "assignedAt", "id");
ALTER TABLE "PacketReleaseRequirement" ADD CONSTRAINT "PacketReleaseRequirement_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PacketRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
