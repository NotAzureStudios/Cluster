# Cluster v0.546.0 · TD6 G20 — Recurring Calendar, Delegation, and Collaboration

**Baseline:** G19 verified source. **State:** G20 source-level implementation complete; full Node24/PostgreSQL/browser/Qt/Windows certification deferred under the permanent implementation-first directive. G20 is a grouped workstream checkpoint, not completion of CD-11 or the full CD-01–CD-20 matrix.

## Connected implementations

1. **Canonical recurring Calendar views:** The Calendar API materializes anchored daily, weekly, weekday and monthly occurrences within bounded requested date windows using the same IANA/DST logic as reminder dispatch. Events retain their canonical series ID; each virtual occurrence has a separate `occurrenceStartsAt` and `occurrenceKey`. Month, week, day, agenda and upcoming Calendar projections include later dates rather than hiding the series after its first start. Query size and range are bounded; unsupported RRULEs are not guessed into supported dates.
2. **Individual occurrence exceptions:** Normalized `CalendarEventOccurrenceException` rows persist skip/restore decisions against the original UTC occurrence instant. The API validates that the instant belongs to the event's anchored recurrence. The series revision is compare-and-swapped transactionally; the skip/restore action is revision guarded and actor-audited, and reminder delivery consults the exact same exception state. DST, skipped days and millisecond precision use the existing canonical recurrence engine.
3. **Delegated Calendar editing:** `delegateIds` are canonical metadata on `CalendarEvent`, not a second Calendar store. The owner/admin can select active editors through the People picker. An editor still needs Calendar tool permissions and applicable Project access. Delegates can edit ordinary content but cannot change owner, Project, audience, visibility, or delegate grants, and cannot delete a series solely through delegation. Private-event delegation is viewable only by the named person and still checks Project scope. Revision guards remain authoritative.
4. **UI integration:** The event editor shows delegated editors and offers **Skip this occurrence** / **Restore** actions on recurring series. Opening a virtual occurrence fetches the canonical event before offering series changes, so selecting a later date cannot inadvertently move the series anchor. Visual conflict indicators use occurrence identities, not repeated series IDs.
5. **Reminder authority:** Due scans and delivery now read occurrence-exception evidence, so skipped dates cannot generate owner or participant reminder notifications. Existing participant ACL and RSVP-decline checks remain in force.

## Verification evidence

- New executable G20 Calendar scenarios: **16/16 passed**. These include the real registered Fastify route handlers exercised with controlled Prisma and authorization dependencies (not a live PostgreSQL instance).
- Inherited G08 attendee reminder suite: **16/16**; G06 owner reminder suite **9/9**.
- Selected G03/G04/G06/G07/G09/G10/G16/G18 suites: **8/8 scripts passed**, retaining Packet, Project release, configuration, Package and transfer protections.
- Source scan: **1,066 TS/TSX**, **0 syntax errors**, **3,180 renderer imports checked**, **0 missing**, **110 CSS**, **0 delimiter errors**.
- PostgreSQL migration added for delegated editors and occurrence exceptions; **not executed against a live database**.

## Explicit scope limits

- An exception currently supports **skip/restore** only. Detached occurrence rescheduling, per-occurrence RSVP/attendance, editing this-and-future, series end dates, and arbitrary RRULEs are **not implemented**.
- A recurring meeting's original Scheduler placement may not be skipped using the exception endpoint. The server refuses cancellation of the anchored occurrence when a Scheduler placement exists, rather than leaving hidden room/resource reservations. A comprehensive recurrence-aware Scheduler reservation system remains open.
- Persisted recurrence exceptions are limited to 256 per series; Calendar query results are bounded. This prevents unbounded DB and UI amplification, not an assertion of large-enterprise scale.
- Only source-level tests were exercised; full React/Qt runtime, generated Prisma client compilation, multi-user PostgreSQL transactions, DST in deployed environments, native binaries and release certification remain open.

## Continuing feature ledger

- **CD-11 Calendar/Scheduler:** G06 owner reminders → G08 participant/recurring reminders → G20 recurrence projection, skip/restore, scoped delegation. Still source-partial.
- **CD-03 / CD-19 Collaboration and shared UX:** Delegated Calendar editing is one integrated operation, not completion of shared collaboration, drafts or Undo/Redo across all workspaces.
- **CD-02 / CD-07 / CD-13:** Advanced Library and media distribution, recipient-aware video, streaming large uploads and Transfer Center orchestration remain open.
- **CD-08:** Supervised Package installation life cycle, elevated repair/uninstall and coordinated dependent Package recovery still open.
- **CD-15 / CD-16:** Broader Help/configuration and Communications workflows remain open.

**Permanent order:** implement remaining CD-01–CD-20 requirements in substantial grouped batches → TD7 cleanup → full runtime certification. Don't return to test-only passes or misrepresent a source checkpoint as a certified release.
