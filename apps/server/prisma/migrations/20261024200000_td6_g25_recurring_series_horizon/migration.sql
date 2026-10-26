-- Preserve legacy indefinite meeting series explicitly; require end dates for new/edited recurring meetings at the API.
ALTER TABLE "CalendarEvent" ADD COLUMN "recurrenceEndDate" TEXT;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_recurrence_end_date_shape" CHECK ("recurrenceEndDate" IS NULL OR "recurrenceEndDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
