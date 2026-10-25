# Cluster G20 → G21 handoff

**Canonical source baseline:** `Cluster-v0.546.0-TD6-G20-Calendar-Recurrence-Delegation-Source.zip`. The complete G20 source archive includes migration, tests, roadmap and source manifest.

**G20 implementation:**
- CalendarEvent `delegateIds`, normalized `CalendarEventOccurrenceException` migration; canonical API GET occurrence projection with distinct virtual occurrence key and bounded range.
- `/api/calendar/events/:eventId/occurrence`: cancel/restore with exact original UTC occurrence, compare-and-swap series revision and authorization. Editor lists skipped occurrences and handles series editing separately.
- `canAccessCalendarEvent` / background equivalent respect delegated editing with tool and Project permissions; delegates may not silently grant others access or delete series.
- `calendar-reminder-occurrences.ts` is the shared recurrence/DST engine used by projection and due-reminder calculation. `calendar-reminder-lifecycle.ts` and `server-job-runtime.ts` fetch exception status so skipped dates do not notify users.
- `npm run cluster:td6:g20` executes targeted G20, G08/G06 Calendar and source scans. G20 tests use a transaction harness, NOT a live database.

**Preserve:** G01–G19 implementations, separate Package install grants, durable archive signing pin, Packet source-vs-recipient privacy and all existing TD6 feature ledger gaps.

**Next recommended grouped implementation:** return to Project/Board/Whiteboard collaboration + cross-tool comments/history, or finish Calendar's detached occurrence reschedules/occurrence RSVP with Scheduler-aware reservations before calling Calendar collaboration complete. Library bulk UX/recipient-safe media, notification settings, contextual Help, large uploads and Package rollback are still material open workstreams.

**Limits:** G20 skip/restore only; no per-occurrence moves/RSVP; original Scheduler reservations explicitly protected. Live Node24/Prisma/PostgreSQL/Qt/Windows certification deferred by standing instruction.
