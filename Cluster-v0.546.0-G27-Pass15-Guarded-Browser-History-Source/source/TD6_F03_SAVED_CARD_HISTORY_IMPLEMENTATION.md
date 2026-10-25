# TD6 F03 — Persistence-safe Card saved-edit Undo/Redo

**Checkpoint:** Cluster v0.546.0 · TD6 F03 (2026-10-17)
**Status:** Implemented in source with focused regression coverage. CD-03 overall remains open.
**Priority:** User-directed implementation first. Runtime certification deliberately deferred.

## Delivered

1. **Atomic metadata history.** A successful `PATCH /api/cards/:cardId` writes Card revision + immutable `CardSavedOperation` record in the same PostgreSQL transaction. History stores only changed fields, previous/next server snapshots, authoritative actor and applied Card revision. Existing Card API shape preserved.
2. **Scoped revision-checked Undo/Redo.** `POST /api/cards/:cardId/saved-history/{undo|redo}` requires the expected Card revision and exact latest history-operation ID, plus current contribute authorization. Only the actor of the last uninterrupted saved operation can undo it. Redo is an explicit follow-on mutation and creates its own durable inverse history entry. Both use DB CAS and rollback atomically if history persistence fails.
3. **No silent overwrite.** An intervening save, move, deletion, out-of-band modification, changed field, mismatched revision, other actor, or wrong Undo/Redo direction blocks the operation with a specific conflict/not-found error. The server never silently merges or retries.
4. **Privacy-sensitive history read.** `GET /api/cards/:cardId/saved-history` requires current Card view permission, is `private, no-store`, and returns at most 40 operation summaries and eligibility, **not before/after field values**.
5. **Image/storage bound.** Operations whose before/after edited metadata exceeds 128 KiB generate an explicit **non-reversible history barrier**, without copying giant cover-image data into a repeated undo ledger.
6. **Real editor integration.** Board Card modal retains its existing *unsaved* local Undo/Redo and three-way 409 review; now also exposes separately named **Undo saved / Redo saved** with a recent saved-edit history list. Buttons are disabled when the local draft is dirty, conflicted, busy, or at an outdated revision. Network failure never silently replays an undo intent. Successful authoritative responses rebase the Card editor and refresh Board/history.
7. **Dependent signals.** Assignment changes reversed through history emit work-assignment activity; Board broadcasts and delivery lifecycle recalculation remain connected.
8. **Schema + migration.** Adds CardSavedOperation model and `20261017210000_td6_card_saved_history` forward migration, with unique per-Card applied revision and Card cascade cleanup.

## Explicit limits

- This is **Card metadata saved-edit history only**, not a universal Undo Engine. Card moves, checklist/comments, deletion, Whiteboard saved operations, external integrations and published deliveries are excluded. The existing unsaved draft undo and merge flows remain separate.
- Only **the latest uninterrupted saved operation** can be reversed. History can be read for up to 40 recent entries but arbitrary historical snapshots cannot be applied. Strict revisions intentionally block undo after a concurrent move/save even if edit fields were disjoint.
- The 128-KiB history barrier explicitly records the change but disables restoration of large content.
- History cascades with Card deletion; authoritative security audit/ActivityEvent retention remains its own domain.
- Source/unit/mocked transaction tests cannot certify PostgreSQL transaction isolation, installed Prisma client, Windows Qt UI, multi-user browser rendering, cross-process reconnect, or release safety.

## Implementation touchpoints

- `apps/server/src/domains/cards/card-saved-history.ts`
- `apps/server/src/domains/cards/{card-repository,card-service,card-routes,card-schemas}.ts`
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/20261017210000_td6_card_saved_history/migration.sql`
- `packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx`
- `packages/renderer/src/features/boards/board-workspace.css`
- `tools/scripts/cluster-td6-card-saved-history-tests.mjs`

## Development validation

- New F03 focused tests: **22/22 passed** including actor scope, fake transactional fault rollback, conflicting stale writes, redo lifecycle, concurrent actor activity, Card move, deletion, out-of-band diverged state, and large metadata barrier.
- Inherited Board Card conflict checks: **21/21 passed**.
- Inherited Board workflows: **26/26 passed**.
- F01 conditional Forms: **20/20 passed**.
- F02 Form deadlines/reminders: **36/36 passed**.
- Respondent Drafts and Forms integration: **68/68 passed** using an ephemeral local symlink to the globally installed TypeScript package (not bundled).
- TD5 P13 committed-outcome unit tests: **18/18 passed**.
- Active TS/TSX parse: **1045 files, 0 syntax diagnostics**; 110 CSS files parsed, 0 errors; 4508 relative imports checked, no authored missing imports. Generated Prisma client absent in this lean source archive.

**No full dependency-backed build, generated Prisma/migration test, actual browser QA or native platform runtime certification is claimed.**
