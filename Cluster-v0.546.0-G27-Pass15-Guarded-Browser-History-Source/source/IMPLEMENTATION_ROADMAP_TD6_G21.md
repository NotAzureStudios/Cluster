# Cluster v0.546.0 · TD5 Source Closeout + TD6 G21 Recurring Meeting Response Integration

**Baseline:** TD6 G20 verified source. **Current state:** TD5 source closeout reconciled; TD6 G21 source slice implemented. Full release certification deferred. CD-11 and CD-03/CD-19 remain **source-partial**, not closed.

## TD5 closeout

All 14 selected P01–P13 source regression scripts pass with 167 individual cases; P12's fixture tracked newer background-job collaborators instead of failing due to stale mocks and hardcoded producer counts. Outstanding P13 exit work is genuine runtime/platform certification. TD5 now counts as `source-closed; runtime-unverified`, with unsafe physical file deletion and automated garbage collection disabled.

## TD6 G21 features delivered

1. **Normalized per-occurrence RSVP/attendance:** `CalendarMeetingOccurrenceResponse` stores original anchored UTC occurrence + event + participant identity and per-row revision. A new migration creates the unique composite key and event FK with cascade cleanup. Series-wide `Meeting.rsvpState` and `attendanceState` remain defaults and are not overwritten by a response to one day.
2. **Authorized API:** `PATCH /api/calendar/events/:eventId/occurrence-response` requires existing Calendar view access, active meeting, valid supported recurring occurrence, actual current participant, and original-series revision. RSVP is self-only; attendance requires organizer/manager. Skipped/cancelled occurrence changes are denied. Per-row CAS revisions and serializable transaction + event advisory lock reject stale responses. Unique-key/serialization races return explicit conflicts. Every successful operation writes actor/occurrence audit evidence.
3. **Bounded read projections:** GET event with `?occurrenceStartsAt=<ISO instant>` reads at most 201 occurrence responses, so opening a series never loads all its history. Calendar range/upcoming overlays load authorized, date-windowed responses in a single bounded batch (explicit conflict on over-limit), merging only the selected occurrence into its meeting RSVP/attendance projection. Other days and the stored series defaults are unchanged.
4. **Reminders:** Recipient eligibility now considers the original-occurrence RSVP override, so a recipient declining only Tuesday does not forfeit Wednesday's reminder. A 201-response ceiling fails closed when reminder evidence is incomplete, preserving original reminder dispatch uniqueness.
5. **UI:** On selected recurring occurrence the event editor shows the day-specific RSVP/attendance, sends expected response revision, and labels one-day vs series-default changes. Original series editing remains distinct; changing series timing is blocked when occurrence exceptions or retained per-occurrence responses exist. Removed/revoked attendees' old responses are pruned on membership changes; changing a meeting into a nonmeeting clears its orphaned responses.

## Executable evidence

- `npm run techdebt:td5:source-closeout`: **14/14 scripts, 167/167 tests passed**.
- `npm run cluster:td6:g21`: **13/13 G21**, **16/16 G20**, **16/16 G08**, **9/9 G06** focused scenarios, plus canonical source scanner (1,066 TS/TSX parsed, 0 syntax errors; 3,180 renderer imports checked, 0 missing; 110 CSS files, 0 delimiter errors).
- Source harness exercises registered route handlers with controlled Prisma transactions; reminder test uses controlled outbox/recipient dependencies. The new migration has **not** been applied to a live PostgreSQL database. Neither real React/Qt auth flow nor native binaries were executed.

## Explicit remaining work

- **CD-11:** Detached instance reschedules, editing this-and-future, full occurrence-aware Scheduler reservations/resource policy and richer calendar overlay/availability interactions are still open. Per-occurrence responses currently require anchored supported recurrence, and protected replies must be reviewed before series timing can be changed; no response-reset UI is shipped in this slice.
- **CD-03/CD-19:** Cross-tool comments, reviews, live presence/drafts and collaboration-safe Undo/Redo still open.
- **CD-02/CD-07/CD-08/CD-13/CD-15/CD-16:** Library media/bulk UX, Package supervised installers/rollback, streaming transfers, expanded setup/help and notification preferences still require grouped feature work.
- **TD7 + platform certification:** Only after feature source closeout. Do not run destructive storage cleanup to try to satisfy tests.
