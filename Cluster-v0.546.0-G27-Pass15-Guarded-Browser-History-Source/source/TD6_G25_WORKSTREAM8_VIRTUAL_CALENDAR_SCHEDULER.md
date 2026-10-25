# Cluster G25 Workstream 8: Calendar/Scheduler virtual capacity and placement UX

**Source parent:** G25 Workstream 7 complete archive. **Status:** substantial G25 source integration; G25 **remains open**.

## Confirmed issue and source changes

A recurring Calendar meeting creates an authoritative Scheduler anchor block and physical blocks for moved instances, **not** a physical block for every weekly/daily/monthly occurrence. Before WS8, only detached Calendar occurrence moves inspected virtual recurring occupancy, and that handler treated *any* shared resource as a full-capacity collision regardless of the resource's actual quantity. Scheduler availability, new/edited Scheduler windows, and new/edited Calendar meetings were blind to unmaterialized recurring instances. This caused both double-bookings and false resource rejections.

### Canonical shared check

- New `apps/server/src/domains/time/scheduler-calendar-availability.ts` resolves relevant Calendar virtual occurrences using the existing timezone/DST-aware projector. It excludes cancelled and moved originals (moved occurrences are physical Scheduler blocks), preserves first-occurrence anchor authority without double counting, and knows the original occurrence key for detached edits.
- `findSchedulePlacementConflicts` combines physical reservations with all overlapping virtual series using quantity-aware interval sweeps. This covers **Calendar detached move/restore, Calendar meeting create/update at their submitted start time, Scheduler availability preview, and Scheduler create/update**, including bounded recurring Scheduler placements. Participant collisions are explicit and severity-high for virtual meetings; room/equipment capacity is checked against the *peak concurrent physical + virtual quantity*, not against a binary occupied flag.
- Candidate lookup is permission-neutral, bounded to relevant user/resource commitments and does not leak competing private meeting titles, descriptions, organizers or project names. Transaction callers already acquire user/resource advisory locks. Calendar changes use their existing serialized operation flow and revision guards.
- Unknown RRULEs, invalid timezones, excess matching series, excess virtual projections, an unbounded range, missing relevant resource capacity or a full physical-range scan produce a high-severity **`calendar-virtual:incomplete`** signal. No incomplete scan is a successful availability result. The Calendar and Scheduler write APIs reject it **even with conflict warnings disabled or override explicitly requested**, using `CALENDAR_AVAILABILITY_INCOMPLETE`. Unknown new meeting RRULEs are rejected at validation, rather than silently placing a recurring meeting that the Scheduler cannot project.
- Editing the whole Calendar series excludes its own former virtual recurrence while editing a detached occurrence excludes just that original instance; neither exclusion suppresses unrelated commitments.
- `SchedulePlanningDialog` presents unavailable vs unverified distinctly; shows quantities where available; never offers **Place anyway** or enabled **Plan window** while the last check was incomplete. Editing the draft clears stale conflicts, enabling recheck. Time Workspace maps server rejection to a recoverable, explicit message instead of claiming save success.

## Existing authority/safety retained

No new Prisma schema/migration, no new Calendar/meeting store or background job, no bypass of Project/person permission checks, no change to original recurring meeting keys or notification dedupe, no physical disposal or native package behavior. All changes share existing `findSchedulePlacementConflicts` and the established Schedule Resource quantity contract.

## Tests and evidence

- `node tools/scripts/cluster-td6-g25-virtual-scheduler-capacity-tests.mjs`: **24/24** source-level tests of quantity capacity, mixed physical/virtual peak, attendee conflicts, skip/move, original-anchor/detached-edit exclusions, private metadata, unsupported RRULE/timezone, bounded candidate queries, stale/incomplete warnings, direct Scheduler planner mock integration and planner UI behavior.
- `npm run cluster:td6:g25`: inherits **24/24**, all prior G25 feature tests, G24, and static source scan.
- `npm run cluster:td6:g25:ticket-parity`: inherited Ticket/Card checks.
- `npm run techdebt:td5:source-closeout`: 14/14 scripts and 167/167 cases.
- These are **source tests and stubbed Prisma checks**, not a live PostgreSQL serializable transaction test, a real server build with generated Prisma Client, a real multiuser scheduling race, or a DPI/Qt visual acceptance run.

## Explicit nonclaims / remaining G25

1. **Recurring series creation and series edit** check their submitted anchor time against all virtual/physical occupancy. They do **not** certify every future date of an indefinite series. The new shared check prevents later Scheduler booking into those virtual commitments, but **future-series-to-future-series collisions still need an approved bounded horizon/expiry policy and UI evidence**, especially for long-lived studio deployments. Do not describe unlimited recurring allocation as exhaustively collision-free.
2. Live performance is unmeasured; a capped 500-series matching scan is a safety bound, **not** a throughput guarantee. Test load, indexes, serializable contention and multiuser behavior before production certification.
3. Cross-editor Board/Whiteboard durable content reversal and reconnect conflict resolution, detailed QA/Project provenance, and other TD6 scope items remain. Do not promote G26 or TD7 until source gaps are addressed or explicitly scoped.
