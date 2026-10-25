# UX-G25-009: Recurring meeting expiry and conflict-safe local work

change_id: UX-G25-009
problem: recurring meetings lacked a reservation end date, so later recurring conflicts were not validated; Whiteboard Keep local removed the conflict barrier and implied a stale draft could be saved.
current_goal: show the real scope of a recurring reservation and never imply that an unreviewed conflicting Whiteboard draft was committed.
historical_decisions: CL-DS-001 v1.3.0 active; bounded series end and preview required; session-only generic cross-editor reversals still provisional, not fully complete.
source_evidence: calendar-series-horizon.ts, calendar-reminder-occurrences.ts, calendar-routes.ts, CalendarPage.tsx, WhiteboardWorkspacePage.tsx, cluster-td6-g25-series-horizon-history-tests.mjs.
reuse: existing Calendar edit form, ClusterTextInput, shared Scheduler availability, WhiteboardRecoveryBanner, existing local recovery draft persistence.
proposed_behavior: recurring meeting creator chooses final date, validates availability across all dates, receives exact first conflicting date, and can only override verified ordinary conflicts. Whiteboard collaboration conflict offers remote load or persistent local recovery copy while keeping Save blocked until conflict reviewed.
states: local draft / saved on device / verifying all recurrence windows / conflict / incomplete verification / committed on server; Whiteboard local recovery copy is not server synced.
migration: do not truncate old indefinite series; editing requires choosing end date; moved exceptions retain original key and physical booking.
validation: 15/15 focused source tests; G25 inherited; pending rendered responsive layout, keyboard/screen reader, heavy series-performance and offline crash recovery; live Windows/Qt DPI certification pending.
exceptions: per-occurrence sequential queries need load/latency measurement; cap 128 occurrences, one year; release UI does not advertise unlimited recurrence.
