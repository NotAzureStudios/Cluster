# Cluster G25 Workstream 9: bounded recurring reservations + safe conflict recovery

**Direct parent:** `Cluster-v0.546.0-TD6-G25-Workstream8-Virtual-Scheduler-Capacity-Source.zip`. **Status:** Workstream 9 source implementation; **G25 remains OPEN**.

## Concrete changes

1. **Explicit end for new/edited recurring meetings:** `CalendarEvent.recurrenceEndDate` is the final local civil date (`YYYY-MM-DD`) in the event's IANA timezone, not a UTC timestamp. The `calendar-series-horizon.ts` authority validates supported recurrence, Gregorian date, 366-day maximum, 128 occurrence cap, and sub-24h meeting duration. The Calendar edit dialog requires a final date; the server independently rejects indefinite meeting creation/edits. Existing indefinite records are retained as NULL and are **not** silently deleted, truncated or assigned an invented expiry. Editing one requires the user to choose a finite horizon; exception-bearing series preserve anchor-lock safeguards.
2. **Future occurrence checks:** inside existing Calendar write transactions and after existing user/resource advisory locks, `checkCalendarSeriesConflicts` projects each occurrence through the DST-aware authoritative projector and calls the existing `findSchedulePlacementConflicts`. It checks **all** occurrences, even after an early ordinary conflict, so a later incomplete scan cannot become user-overridable. Read/resource/participant authority remains server-owned; conflict details are capped at 12, shown with first failing date, without exposing private meeting titles. For an unverified occurrence, writes fail with `CALENDAR_AVAILABILITY_INCOMPLETE`.
3. **Real end semantics:** occurrence listing, reminder due checks and occurrence validity honor the final local date. Legacy null-end series retain their previous behavior. Physical detached Scheduler reservations remain separate and continue to appear if moved past the series' end. New index-shaped query predicates remove already-expired series from normal virtual Scheduler scanning, Calendar listing and reminder polling; moved exceptions stay eligible for Calendar views/reminders after the original series ends. The recurring projection scans the 366-day horizon in 60-day bounded windows without silently truncating a large recurrence.
4. **Collaborative recovery:** Whiteboard's prior `Keep local` action discarded a newer-server conflict barrier and could lead to misleading 'save now' instructions. Its replacement **Preserve local recovery copy** persists the local snapshot without clearing `pendingRemote`; manually invoking Save while this barrier exists is blocked with a truthful message. Loading the server version remains explicit. Native text-area history and CAS-based server Undo/Redo from WS6/WS7 are preserved.
5. **Source coverage:** new Prisma migration `20261024200000_td6_g25_recurring_series_horizon`, shared Calendar input type, Calendar editor, both Calendar CRUD write paths, recurrence projector, Scheduler virtual candidate query, background reminder query, design change record and focused regression command integrated into `cluster:td6:g25`.

## Verification and limitations

- `node tools/scripts/cluster-td6-g25-series-horizon-history-tests.mjs`: 15/15 (horizon, DST, recurrence bounds, all-slot checks, late fail-close, no implicit legacy truncation, candidate query shape, moved exceptions, Whiteboard recovery).
- `npm run cluster:td6:g25`: inherited TD6 source suites and source scan passed.
- `npm run cluster:td6:g25:ticket-parity`: 20/20 Ticket parity plus 22/22 existing Card saved history passed.
- `npm run techdebt:td5:source-closeout`: 14 scripts / 167 cases passed.

**Not certified:** Local test harness stubs Prisma and route state; no live PostgreSQL migration, regenerated Prisma client, Node 24 production build, multi-user contention, 128-occurrence latency measurement, actual browser rendering, offline crash test or native Qt/Windows certification has been performed. Per-occurrence validation currently performs bounded sequential availability queries and may need batched snapshot optimization after real workload measurement; `128` is a safety cap, not a throughput guarantee. Do **not** claim unlimited-duration reservations, automatic expiry renewal or zero-collision distributed scheduling. Keep incomplete-result fail-closed semantics. Existing manual allow-conflicts behavior remains user-authorized for *verified* ordinary conflicts, never incomplete results.

## Remaining G25

- Cross-editor Board/Whiteboard fully durable content reversal and conflict-aware three-way reconciliation; current local-draft/revision tools cover many but not all operations.
- Exact end-to-end Ticket, Project/QA, review and Calendar navigation/privacy integration acceptance, and any reconciliation findings against the complete CD-01–CD-20 ledger. Avoid making G26 depend on inventing another shared history engine, but do not call G25 closed on these source-only checks.
- Full actual runtime certification happens later, after TD7.
