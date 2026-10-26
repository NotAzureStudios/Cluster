-- Opt-in published Packet note derivatives. Content is an immutable detached
-- TEXT derivative, not a reference to the canonical Library storage path.
CREATE TABLE "PacketReleaseDerivative" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "releaseId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "content" BYTEA NOT NULL,
  "sha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PacketReleaseDerivative_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "PacketRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PacketReleaseDerivative_releaseId_position_key" ON "PacketReleaseDerivative"("releaseId", "position");
ALTER TABLE "PacketReleaseDerivative" ADD CONSTRAINT "PacketReleaseDerivative_position_positive" CHECK ("position" > 0);
ALTER TABLE "PacketReleaseDerivative" ADD CONSTRAINT "PacketReleaseDerivative_size_bounded" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 65536);
