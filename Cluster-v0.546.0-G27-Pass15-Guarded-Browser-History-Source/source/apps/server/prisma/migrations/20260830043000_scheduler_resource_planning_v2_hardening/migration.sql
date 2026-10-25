-- Block J2 Scheduler/resource-planning hardening.
ALTER TABLE "ScheduleBlock" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "ScheduleBlock" ADD COLUMN IF NOT EXISTS "recurrenceGroupId" TEXT;
ALTER TABLE "ScheduleBlock" ADD COLUMN IF NOT EXISTS "recurrenceIndex" INTEGER;
ALTER TABLE "ScheduleBlock" ADD COLUMN IF NOT EXISTS "recurrenceFrequency" TEXT;
CREATE INDEX IF NOT EXISTS "ScheduleBlock_recurrenceGroupId_recurrenceIndex_idx" ON "ScheduleBlock"("recurrenceGroupId", "recurrenceIndex");
