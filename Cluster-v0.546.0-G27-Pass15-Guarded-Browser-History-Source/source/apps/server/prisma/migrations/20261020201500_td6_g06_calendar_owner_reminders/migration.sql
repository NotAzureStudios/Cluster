CREATE TABLE "CalendarEventReminderDispatch" (
  "id" TEXT NOT NULL,
  "calendarEventId" TEXT NOT NULL,
  "eventRevision" INTEGER NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "activityEventId" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarEventReminderDispatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarEventReminderDispatch_calendarEventId_eventRevision_key" ON "CalendarEventReminderDispatch"("calendarEventId", "eventRevision");
CREATE INDEX "CalendarEventReminderDispatch_ownerUserId_sentAt_idx" ON "CalendarEventReminderDispatch"("ownerUserId", "sentAt");
ALTER TABLE "CalendarEventReminderDispatch" ADD CONSTRAINT "CalendarEventReminderDispatch_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
