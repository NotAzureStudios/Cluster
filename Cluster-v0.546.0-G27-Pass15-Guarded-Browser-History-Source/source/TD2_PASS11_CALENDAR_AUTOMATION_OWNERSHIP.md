# TD2 Pass 11 — Calendar automation runtime availability

**Parent:** `Cluster-v0.546.0-TD2-Pass10-Shutdown-Claim-Drain-Source.zip`.

## Why

Calendar's periodic enqueue timer and its durable queue claim were already owned by the Studio `calendarEnabled` switch. Two still-active execution paths remained:

1. The five-minute durable `automation.calendar-scan` handler entered `scanStudioAutomationCalendar()` with no further gate, then could process up to 5,000 events after the Studio disabled Calendar on another server.
2. The shared activity-to-Studio-automation event consumer processed `calendar_event` changes even while the Calendar tool was disabled. Its Project/Ticket/custom-field triggers are shared services and must remain running.

## Source changes

- `server-job-runtime.ts` now passes `throwIfToolUnavailable()` into the Calendar scan delegate.
- `server-automation-job-runtime.ts` threads the callback into the existing scan implementation, and supplies the shared event bridge with a **fresh, authoritative** availability read for Calendar events (`readSettings(true)`), guarded by the local owner state.
- `studio-automation-event-bridge.ts` checks Calendar availability before querying an event. A disabled Calendar event is skipped; the shared consumer stays active for Projects, Tickets, and custom fields. Settings-read failures propagate for normal outbox retry instead of allowing uncertain optional execution.
- The scan checks availability before querying, between bounded groups of 64 events, and after processing. This avoids one DB/lease read per item, while limiting late work after a disable to at most the rest of the current group.
- Added an executable eight-case regression suite (`techdebt:td2:calendar`) covering disabled entry, long-scan races, bounded checks, healthy work, disabled activity, enabled activity, independent Project automation, and fail-closed Settings errors.

## Safety boundary and explicit semantics

A disabled Calendar **does not queue historical activity-driven automations for later replay**. Calendar activity arriving while disabled is intentionally acknowledged without optional automation processing; the ordinary durable Calendar scan remains queued and will resume after re-enable. Restoring a Calendar does not suddenly flood users with historical creation events. Existing Project/Ticket automations remain independent. The event outbox should be integration-tested under real PostgreSQL before certification.

In-flight checks are cooperative. An event already in `processEvent()` may finish, and up to 63 more scan entries may execute following a remote disable, depending on the checkpoint position. No global exactly-once or side-effect fencing claim. Real PostgreSQL multi-server behavior, full Node 24 build, Windows, and resource-usage measurement remain outstanding.

No Prisma schema or native binary changes.
