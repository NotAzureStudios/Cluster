# Cluster TD6 G06 | Admin + Calendar + Communications

**Canonical parent:** v0.546.0 TD6 G05. **Delivery:** grouped, source-level implementation checkpoint. 1.0 release certification and provisioned Windows/PostgreSQL remain deferred under the user's implementation-first directive.

## Implementation completed in G06

| Connected surface | Source changes | Safety and limits |
|---|---|---|
| Studio Announcements | Draft or scheduled publication, adjustable future date, cancellation back to draft, revision-aware admin controls | Manual publish requires draft; scheduled job cannot publish early |
| Communications delivery | Publication status, audience snapshot, activity, and durable domain-event outbox written atomically | Failures roll back entire publication; no duplicate sends from competing worker claims; 5,000 recipients max |
| Audience authority | Strict audience resolver on publication; inactive/expired/suspended accounts excluded | Failed People/Team/Project audience reads fail closed; no broad fallback |
| Scheduler | Existing durable job runtime enqueues due announcements on 60-second cadence | No empty job enqueued when nothing is due; retries preserve scheduled state |
| Calendar | Owner-only reminders for non-recurring scheduled Calendar events with `reminderMinutes` set | Revision-unique durable dispatch; cancellation, privacy, account eligibility, disabled tool checked; attendee reminders explicitly NOT implemented |
| Calendar background lifecycle | Calendar-owned job and execution gating with no idle jobs while no reminder due | Explicit bounded scan error for more than 500 applicable events; separate provider-level work deferred |
| Operations / Studio Settings | Scheduled-announcement count, owner-reminder description, author scheduling controls and delivery report retained | Read counts are projections; report reflects canonical Inbox read/acknowledged evidence |
| Database | `StudioAnnouncement.scheduledAt/cancelledAt/revision`, `CalendarEventReminderDispatch` and indexes | Two additive migrations; live migration execution deferred |

## Tests and evidence

- `node tools/scripts/cluster-td6-g06-announcement-schedule-tests.mjs` (10/10): actual route handler with CAS, manual-vs-scheduled policy, duplicate workers, atomic outbox rollback, strict audience, future schedule.
- `node tools/scripts/cluster-td6-g06-calendar-reminders-tests.mjs` (9/9): owner-only visibility, revision idempotence, disabled owner, recurring/event cancellation, transaction rollback, bounded scan, tool ownership.
- `npm run techdebt:td6:source-scan`: 1,061 TS/TSX files, 0 parse errors; 3,177 renderer-relative imports, 0 missing; 110 CSS, 0 delimiter errors.
- F01–G05 selected source regressions plus TD1 Calendar inheritance/runtime and prior setup/onboarding assertions passed. `cluster:0506:settings:assertions` remains **8/9** on both G05 and G06 because it expects obsolete `await patchSettings(patch)` spelling in tool settings routes; this is **not** a new G06 failure.
- No full TypeScript dependency-backed build, Prisma generate/migrate, provisioned multi-instance PostgreSQL event processing, authenticated browser testing, or Windows/Qt release certification was performed.

## Open requirements, not to mislabel complete

1. Attendee reminders require per-recipient canonical Calendar authorization and dedupe for recurring occurrences, especially Project denies and private/participant visibility.
2. Admins need richer announcement authoring (edit draft contents and audiences, expiry, audience preview, templates, policy approvals, signed publication snapshots, delegated review).
3. Server policy/config import/export and broad OOBE setup enhancements remain feature-ledger requirements, not closed by G06.
4. Admin availability overlays, multi-calendar recurrence, timezone/DST UX and studio-wide resource availability still need work.
5. Communications channels (Discord/email/desktop) still depend on delivery lifecycle and provider settings; the durable Inbox event is the authoritative publication obligation, not proof of client receipt.
6. Supervised OS installers, comprehensive video derivatives, broader collaboration and CD-01 through CD-20 gaps remain open.

## Next grouped batch: TD6 G07

Cross-tool UX and definitive CD-01–CD-20 audit of **backend / UI / integrated / certified** status. Group related missing feature implementations rather than polishing one menu per pass. Preserve untouched functionality and the source-code-first priority. After feature code completion: TD7 cleanup, then runtime certification.
