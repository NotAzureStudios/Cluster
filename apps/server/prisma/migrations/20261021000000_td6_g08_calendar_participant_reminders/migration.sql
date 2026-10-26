-- G08: per-recipient reminders; preserve existing owner dispatch evidence.
ALTER TABLE "CalendarEvent" ADD COLUMN "reminderAudience" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "CalendarEventReminderDispatch" RENAME COLUMN "ownerUserId" TO "recipientUserId";
DROP INDEX IF EXISTS "CalendarEventReminderDispatch_calendarEventId_eventRevision_key";
ALTER TABLE "CalendarEventReminderDispatch" ADD COLUMN "occurrenceStartsAt" TIMESTAMP(3);
UPDATE "CalendarEventReminderDispatch" AS dispatch
SET "occurrenceStartsAt" = event."startsAt"
FROM "CalendarEvent" AS event WHERE dispatch."calendarEventId" = event."id";
ALTER TABLE "CalendarEventReminderDispatch" ALTER COLUMN "occurrenceStartsAt" SET NOT NULL;
CREATE UNIQUE INDEX "CalendarEventReminderDispatch_calendarEventId_eventRevision_occurrenceStartsAt_recipientUserId_key"
  ON "CalendarEventReminderDispatch"("calendarEventId", "eventRevision", "occurrenceStartsAt", "recipientUserId");
DROP INDEX IF EXISTS "CalendarEventReminderDispatch_ownerUserId_sentAt_idx";
CREATE INDEX "CalendarEventReminderDispatch_recipientUserId_sentAt_idx"
  ON "CalendarEventReminderDispatch"("recipientUserId", "sentAt");
