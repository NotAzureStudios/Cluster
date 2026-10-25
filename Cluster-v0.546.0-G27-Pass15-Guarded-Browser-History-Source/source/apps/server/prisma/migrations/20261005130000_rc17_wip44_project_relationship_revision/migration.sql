-- RC17 WIP44: Project workflow relationships participate in optimistic concurrency.
ALTER TABLE "ProjectRelationship" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProjectRelationship" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
