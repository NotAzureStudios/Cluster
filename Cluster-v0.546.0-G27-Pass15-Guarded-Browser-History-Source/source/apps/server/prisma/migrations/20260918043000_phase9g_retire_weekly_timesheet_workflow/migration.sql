-- Phase 9G: weekly submit/approve/reopen timesheet state is retired.
-- TimeEntry remains the actual-time authority; historical approval semantics are intentionally removed.
DROP TABLE IF EXISTS "TimesheetWeek";
