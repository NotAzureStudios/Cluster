# Cluster v0.546.0 — TD6 G25 Workstream 16: Board/List lifecycle and Ticket authority convergence

**Parent:** G25 Workstream 15 full source. **Scope:** production code, database migration, shared UI, targeted source/runtime-harness tests, regression integration. **Status:** G25 source still under closeout audit. **No live PostgreSQL/Node24/Windows/Qt certification.**

## Grouped changes

1. **Non-destructive Board List lifecycle:** adds `BoardList.archived` and migration `20261026000000_td6_g25_board_list_lifecycle`. Permission-protected `POST /api/lists/:listId/lifecycle` supports archive/restore, requires current List revision, rejects archiving when any *active* Card or Ticket remains, preserves archived Cards and their IDs, and writes a saved-history barrier. Transitions are serializable and fail closed on serialization/revision conflicts.
2. **Archive recovery:** default Board detail returns active columns; a separate no-store, Board-access-checked `GET /api/boards/:boardId/archived-lists` returns column metadata, **not counts of restricted Cards**. Board tools show archived columns and restore actions, with refresh and clear states. Archived Card tray stays useful, but refuses to restore Card from archived column until that List has been restored. In-place Board column menu now offers Archive, not Delete.
3. **Destruction safety:** permanent List deletion checks current revision and *all* Cards, Tickets and saved List operations before deletion; no cascading Card tombstones. Blocked deletion returns 409. Board deletion refuses when it still has Cards or saved List history. No pretend Undo for physical delete.
4. **Cross-tool archive guards:** Ticket resolver, Project automation, Discord intake, Project Control materialization, Card creation/duplication and move endpoints and repository targets reject archived columns. Reorder/history avoid archived columns. Active List projection and Project Control link candidates ignore archived columns.
5. **Ticket authority correction:** Admin ticket summary and `archive-resolved` use `ticketStage === "resolved"`, not List `isDone`. Search status of Tickets uses the explicit triage stage, rather than Board List names. This fixes two further places where rejected/unresolved Tickets could be reported as resolved.
6. **Project follow-up materialization:** Project Control Ticket creation no longer generates a fallback Board and Lists or grabs the first Board. The route requires explicit `destinationBoardId` + `destinationListId`, verifies same Project, active Board, active non-Done List and current contribution authority; it rejects duplicate links into another List. It creates Tickets with the canonical `new` stage. Project Control, specialized production workspace, and Video Review follow-up UI share a compact destination selector.
7. **Visual improvements:** less destructive menu affordances, compact Archive/Restore surface, clearer blocked status, no new modal framework, no per-List polling. New styles live in existing Board/Project CSS owners.

## Source-level acceptance

- New lifecycle transaction tests: 24 focused cases (active/archived Cards, history/identity retention, concurrency, authorization-bounding, rollback and guarded deletion).
- New route tests: 10 cases for access checks, conflicts, privacy-safe recovery, and deletion mapping.
- New cross-tool registered-route tests: 14 cases including missing/incorrect/archived destination, permissions, idempotency, stage provenance, source assertions.
- Existing Board 0.534 source tests updated to assert no-cascade safety instead of expecting destructive List deletion.
- See `TD6_G25_WORKSTREAM16_VERIFICATION.json` and `tools/scripts/cluster-td6-g25-ws16-*.mjs` for executable evidence.

## Safety limitations, no certification shortcuts

- `P2034` retry conflicts and transaction rollback are modeled in tests but have not been exercised against live PostgreSQL contention. In particular Card writers outside the List lifecycle transaction may require a stronger shared row lock/admission invariant for simultaneous archive/create races; this remains a real multiuser certification target. **Do not treat an archive as proof of a fully atomic exclusion of concurrent Card insertion until integration-tested.**
- Archived column access still requires current Board permission. Cached snapshots and separately authorized Card content must be checked after revocation during authenticated browser tests.
- `BoardList.archived` is a new Prisma schema field. The migration is included but **unapplied**. Prisma client generation/build remains deferred; source tests and TypeScript syntax scan are not typechecks.
- Board archive (distinct from List archive), bulk moves, cross-tab CAS fallback, review/QA transaction contention, and comprehensive multiple-user undo/reconnect scenarios need source-level audit and runtime checks. Do not claim all of G25 closed merely because the regression suite is green.
- Destructive disk disposal remains separately gated by TD5 full runtime certification. No physical deletion or native executable changed.

## Official style guide

CL-DS-001 v1.3.0 is the official, external Library policy. UX change record `docs/design/UX_G25_WS16_LIST_LIFECYCLE_TICKET_AUTHORITY.md` documents this source change. It does not claim the Library's standalone style guide was embedded into this source ZIP.
