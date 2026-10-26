-- Freshly generated PDF derivatives contain only eligible detached note text.
-- Existing text derivatives remain text; no original Library blob is exposed.
ALTER TABLE "PacketReleaseDerivative" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'txt';
