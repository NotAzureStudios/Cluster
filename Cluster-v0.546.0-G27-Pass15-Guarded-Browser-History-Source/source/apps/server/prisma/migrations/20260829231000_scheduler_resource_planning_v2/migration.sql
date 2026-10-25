ALTER TABLE "ScheduleBlock"
  ADD COLUMN IF NOT EXISTS "calendarEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "windowKind" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS "participantIds" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "calendarSync" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "ScheduleResource" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "quantityTotal" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "tags" TEXT NOT NULL DEFAULT '[]',
  "projectTypeIds" TEXT NOT NULL DEFAULT '[]',
  "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ScheduleResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScheduleBlockResource" (
  "id" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleBlockResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduleBlock_projectId_startsAt_idx" ON "ScheduleBlock"("projectId", "startsAt");
CREATE INDEX IF NOT EXISTS "ScheduleBlock_calendarEventId_idx" ON "ScheduleBlock"("calendarEventId");
CREATE INDEX IF NOT EXISTS "ScheduleBlock_status_startsAt_idx" ON "ScheduleBlock"("status", "startsAt");
CREATE INDEX IF NOT EXISTS "ScheduleBlock_windowKind_startsAt_idx" ON "ScheduleBlock"("windowKind", "startsAt");
CREATE INDEX IF NOT EXISTS "ScheduleResource_status_type_name_idx" ON "ScheduleResource"("status", "type", "name");
CREATE INDEX IF NOT EXISTS "ScheduleResource_type_name_idx" ON "ScheduleResource"("type", "name");
CREATE INDEX IF NOT EXISTS "ScheduleResource_updatedAt_idx" ON "ScheduleResource"("updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleBlockResource_blockId_resourceId_key" ON "ScheduleBlockResource"("blockId", "resourceId");
CREATE INDEX IF NOT EXISTS "ScheduleBlockResource_resourceId_blockId_idx" ON "ScheduleBlockResource"("resourceId", "blockId");

DO $$ BEGIN
  ALTER TABLE "ScheduleBlock"
    ADD CONSTRAINT "ScheduleBlock_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ScheduleBlockResource"
    ADD CONSTRAINT "ScheduleBlockResource_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "ScheduleBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ScheduleBlockResource"
    ADD CONSTRAINT "ScheduleBlockResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ScheduleResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
