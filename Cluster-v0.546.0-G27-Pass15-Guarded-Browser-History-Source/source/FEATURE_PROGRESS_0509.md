# Cluster v0.509 | Work System consolidation

**Status: source work transitioned into 0.510.0; substantial Work System scope remains open. Not runtime-certified.**

## Source-implemented in the 0.509 development wave (October 8, 2026)

- Board Timeline lens over canonical Card.startDate/dueDate, with a 12-week viewport, navigation, unscheduled and offscreen groups, date-reversal visibility, and DST-safe calendar-day parsing; Board saved views accept the new lens.
- Shared EntityComment optimistic revision across edits, moderation, deletion and reactions. Atomic conditional updates prevent lost changes. Reactions retry a bounded number of times and safely merge independent writers; client sends observed revision and re-fetches on conflict.
- Comment deletion of unattributed records restricted to admins. UI suppresses delete for unauthorized users and duplicate comment mutations.
- Board column reordering is now an atomic Serializable transaction with per-row revision/position checks, rollback on partial conflict, and 409 handling. The UI sends the observed column revision and refreshes on conflict.
- New PostgreSQL migration `20261008210000_entity_comment_revisions`, not applied in this checkpoint.
- 0.509 focused tests: 24 new executable assertions. Earlier 0.507/0.508 focused regressions: 15 suites, 314 assertions, passed. Full Node 24+, Prisma/PostgreSQL and Windows verification remains open.

**Important:** This is not a completed universal Work System. Shared task/status lenses outside Boards, Whiteboard conversion, comprehensive comment history/mentions, cross-tool undo/redo, automation and offline multi-writer certification are still backlog. We deliberately did not clone existing Card, EntityComment or ProjectRelationship authority.


The next development wave converges Boards, Whiteboards, Tickets, Actions, reviews and dependency relationships onto canonical work/resource identity, command history and shared interactions.

## Major work

1. Shared work item identity, effective Project/Team scope, status taxonomy and lifecycle.
2. Board/Table/List/Timeline/Calendar lenses over a common work model, without copying records.
3. Shared comments/mentions and notifications contract with permissions and deduplication.
4. Collision-safe actions: idempotency, autosave, revisions, undo/redo, conflict previews.
5. Reviews, approvals, work dependencies and the Resource Graph.
6. Realtime multi-editor correctness, offline replay and durable reconnect behavior.
7. Shared Resource Picker, Action Registry, inspector and Bulk Action UI expansion.

**Carry-forward from 0.507/0.508:** per-person positive scoped grants, real Packet delivery/entitlement engine, Vault recoverability/secure UI, onboarding/offboarding depth. These requirements remain in the ledger, not silently marked delivered.

**Certification gate:** Pass 14/15 merge, PostgreSQL/runtime build, security/multi-user tests, Windows/Qt parity and native installers still pending; no claim of production readiness.
