-- G21: per-occurrence meeting responses with no series RSVP mutation.
CREATE TABLE "CalendarMeetingOccurrenceResponse" (
  "id" TEXT NOT NULL,
  "calendarEventId" TEXT NOT NULL,
  "occurrenceStartsAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "rsvpStatus" TEXT,
  "attendanceStatus" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarMeetingOccurrenceResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceStartsAt_userId_key"
  ON "CalendarMeetingOccurrenceResponse"("calendarEventId", "occurrenceStartsAt", "userId");
-- The (calendarEventId, occurrenceStartsAt, userId) UNIQUE B-tree index
-- already supports lookups by its first two columns. A second, prefix-only
-- index is redundant and collides with the unique index after PostgreSQL
-- truncates identifier names to 63 bytes. Do not add it back.
ALTER TABLE "CalendarMeetingOccurrenceResponse" ADD CONSTRAINT "CalendarMeetingOccurrenceResponse_calendarEventId_fkey"
  FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
