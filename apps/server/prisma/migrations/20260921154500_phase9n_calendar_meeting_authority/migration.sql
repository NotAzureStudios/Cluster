-- Phase 9N Calendar / Meeting / Scheduler convergence.
ALTER TABLE "ScheduleBlock" ADD COLUMN "placementAuthority" TEXT NOT NULL DEFAULT 'scheduler';

CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "agenda" TEXT,
    "notes" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "visibility" TEXT NOT NULL DEFAULT 'project',
    "rsvpState" TEXT NOT NULL DEFAULT '{}',
    "attendanceState" TEXT NOT NULL DEFAULT '{}',
    "attachmentIds" TEXT NOT NULL DEFAULT '[]',
    "decisionIds" TEXT NOT NULL DEFAULT '[]',
    "actionItemIds" TEXT NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meeting_calendarEventId_key" ON "Meeting"("calendarEventId");
CREATE INDEX "Meeting_organizerId_updatedAt_idx" ON "Meeting"("organizerId", "updatedAt");
CREATE INDEX "Meeting_visibility_updatedAt_idx" ON "Meeting"("visibility", "updatedAt");
CREATE INDEX "ScheduleBlock_placementAuthority_calendarEventId_idx" ON "ScheduleBlock"("placementAuthority", "calendarEventId");

ALTER TABLE "Meeting"
ADD CONSTRAINT "Meeting_calendarEventId_fkey"
FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
