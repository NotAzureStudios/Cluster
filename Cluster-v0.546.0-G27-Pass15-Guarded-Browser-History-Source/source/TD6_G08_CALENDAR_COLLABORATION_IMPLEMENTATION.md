# Cluster TD6 G08: participant-safe and recurring Calendar reminders

**Parent source:** TD6 G07. **Status:** G08 source implementation checkpoint, not a complete Calendar or Communications release.

## Implemented together

1. **Calendar authoring and shared contract.** Calendar events persist `reminderAudience = owner | participants`. Owner-only stays the default. The event editor offers **Owner only** or **Owner and eligible attendees**. The existing reminder lead-time choices remain in place.
2. **Recipient authorization.** Background reminders use `canAccessCalendarEventAsActor`, backed by the existing Calendar tool permission and target Access Rule decision, instead of assuming an attendee ID grants permission to read a private or Project-scoped event. Eligible audience membership is rechecked at delivery. Declined RSVP participants are skipped; archived, suspended, disabled and expired accounts are excluded.
3. **Individual durable notifications.** Each eligible recipient receives a separate activity/outbox event with exactly one recipient ID, preventing recipient identity leakage through notification payload fanout. The durable dispatch key is `(event, event revision, occurrence instant, recipient)`. Competing workers cannot issue the same reminder twice; failures during auditing/outbox insertion roll back the entire batch. Changed event revisions may legitimately issue a new reminder.
4. **Recurring reminder delivery.** Bounded local-time recurrence supports the four options the Calendar UI already offers: daily, weekly, weekdays and monthly. The calculated occurrence instant is included in notification contents, group identity, and dispatch provenance. An IANA timezone preserves the original anchored local wall time across DST; nonexistent spring-forward local times are skipped. Unsupported RRULEs with reminders are rejected by the event API rather than silently guessed.
5. **Admin Operations visibility.** Admin-only aggregate summary shows dispatched reminders over the previous 24 hours and the count of attendee-enabled scheduled events; it does not reveal event titles or recipients.
6. **Worker efficiency and lifecycle.** The existing Calendar tool kill switch and adaptive 60-second wake-up are preserved. Due-work preflight now checks both ordinary and recurring events and fails on truncated bounded queries. No additional perpetual polling loop was created.

## Test evidence

- G08 16/16 focused checks passed. In-memory transaction testing covers denied Project access, private events, stale/declined attendees, revoked/expired accounts, concurrent delivery, unique recipient/occurrence receipts, outbox rollback and malformed participant data. Recurrence tests include spring/fall DST, weekdays and skipped invalid monthly dates.
- Inherited G06 Calendar suite 9/9 and scheduled announcements 10/10, G07 cross-tool 12/12; F01/F02, G02–G05 selected suites passed.
- Source scan: 1,062 TS/TSX files; zero syntax/CSS issues, zero missing authored imports; generated Prisma client remains absent in lean source package.

## Explicitly unfinished

- Calendar **recurring event visualization/expansion** across month/week/year views and per-occurrence edits/exceptions remain unfinished. This pass implements reminder occurrence identity, not complete recurrence UI.
- Arbitrary RRULEs, UNTIL/COUNT and time-shifted occurrences are not yet supported by this notification engine. Changing the event's timezone in the existing editor still uses the browser-local time input for its anchor, which needs a dedicated authoring UX pass.
- Per-recipient preference controls, attendee-wide Calendar sharing/delegated editing, and reminder delivery through external channels remain open.
- The Calendar preflight is intentionally bounded to 500 candidate events. An oversized eligible recurrence population fails loudly instead of silently dropping reminders; a paginated/partitioned scanner remains future work.
- Live PostgreSQL serialization, Node24 dependency-backed build, authenticated multiuser/browser tests and native Windows/Qt are still deferred. Source tests are not runtime certification.
