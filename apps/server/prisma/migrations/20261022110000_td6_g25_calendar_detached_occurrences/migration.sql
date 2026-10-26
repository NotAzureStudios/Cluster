-- Canonical original occurrence key remains stable when a single instance moves.
ALTER TABLE "CalendarEventOccurrenceException" ADD COLUMN "movedStartsAt" TIMESTAMP(3), ADD COLUMN "movedEndsAt" TIMESTAMP(3);
ALTER TABLE "ScheduleBlock" ADD COLUMN "occurrenceStartsAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ScheduleBlock_calendar_occurrence_key" ON "ScheduleBlock"("calendarEventId", "occurrenceStartsAt");
-- A moved occurrence must carry a complete valid half-open range.
ALTER TABLE "CalendarEventOccurrenceException" ADD CONSTRAINT "calendar_occurrence_move_shape" CHECK (
  ("status" = 'cancelled' AND "movedStartsAt" IS NULL AND "movedEndsAt" IS NULL)
  OR ("status" = 'rescheduled' AND "movedStartsAt" IS NOT NULL AND "movedEndsAt" IS NOT NULL AND "movedStartsAt" < "movedEndsAt")
);
