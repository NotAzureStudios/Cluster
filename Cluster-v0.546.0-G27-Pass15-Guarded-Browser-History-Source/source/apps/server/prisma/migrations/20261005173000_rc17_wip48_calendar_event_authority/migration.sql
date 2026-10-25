-- WIP48: converge shared Calendar context and visibility onto CalendarEvent.
ALTER TABLE "CalendarEvent" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'studio';
ALTER TABLE "CalendarEvent" ADD COLUMN "notes" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "CalendarEvent" ADD COLUMN "attachmentIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CalendarEvent" ADD COLUMN "decisionIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CalendarEvent" ADD COLUMN "actionItemIds" TEXT NOT NULL DEFAULT '[]';

UPDATE "CalendarEvent" AS event
SET "visibility" = meeting."visibility",
    "notes" = meeting."notes",
    "timezone" = meeting."timezone",
    "attachmentIds" = meeting."attachmentIds",
    "decisionIds" = meeting."decisionIds",
    "actionItemIds" = meeting."actionItemIds"
FROM "Meeting" AS meeting
WHERE meeting."calendarEventId" = event."id";

-- Studio/no-project events are Studio-visible by default; project events stay project-scoped.
UPDATE "CalendarEvent" SET "visibility" = 'project' WHERE "projectId" IS NOT NULL AND "visibility" = 'studio';

ALTER TABLE "Meeting" DROP COLUMN "notes";
ALTER TABLE "Meeting" DROP COLUMN "timezone";
ALTER TABLE "Meeting" DROP COLUMN "visibility";
ALTER TABLE "Meeting" DROP COLUMN "attachmentIds";
ALTER TABLE "Meeting" DROP COLUMN "decisionIds";
ALTER TABLE "Meeting" DROP COLUMN "actionItemIds";

CREATE INDEX "CalendarEvent_visibility_startsAt_idx" ON "CalendarEvent"("visibility", "startsAt");
