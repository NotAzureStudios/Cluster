-- Revision-based concurrency on the existing canonical EntityComment authority.
ALTER TABLE "EntityComment" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
