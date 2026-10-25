ALTER TABLE "CalendarEvent" ADD COLUMN "delegateIds" TEXT NOT NULL DEFAULT '[]';
CREATE TABLE "CalendarEventOccurrenceException" (
  "id" TEXT NOT NULL,
  "calendarEventId" TEXT NOT NULL,
  "occurrenceStartsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'cancelled',
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarEventOccurrenceException_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarEventOccurrenceException_calendarEventId_occurrenceStartsAt_key" ON "CalendarEventOccurrenceException"("calendarEventId", "occurrenceStartsAt");
CREATE INDEX "CalendarEventOccurrenceException_calendarEventId_createdAt_idx" ON "CalendarEventOccurrenceException"("calendarEventId", "createdAt");
ALTER TABLE "CalendarEventOccurrenceException" ADD CONSTRAINT "CalendarEventOccurrenceException_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
