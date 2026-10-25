# Cluster v0.546.0 | TD6 G25 Workstream 15: Board column history and replay leadership

**Source checkpoint:** `Cluster-v0.546.0-TD6-G25-Workstream15-Board-Column-History-Sync-Leadership-Source.zip`.
**Parent:** Workstream 14 full source, byte-for-byte patch replay required.
**Scope:** G25 implementation checkpoint; TD6/G25 overall **open**. No live runtime certification.

## Connected implementation

1. Durable metadata history for Board Lists using `BoardListSavedOperation`, with a new PostgreSQL migration. Supported reversible fields: title, description, color, WIP limit, collapsed, assigned user IDs. Server snapshots are atomic with a revision CAS and stored with a bounded size. Read APIs list only operation metadata, never private before/after values. Only the latest uninterrupted edit by the same authenticated actor can be reversed.
2. Board List **left/right reorder** now records a server-owned two-column operation in the same serializable transaction that swaps both positions and revisions. Undo/Redo validates both list records, both positions, current revisions and actor ownership before restoring the pair. A changed or missing neighbor cancels reversal; a transaction error cannot leave a half-swapped Board. No independent client snapshot or fake local success.
3. A change to `isDone` mutates Card completion data. The transaction persists a deliberate **history barrier**, not a misleading metadata-only Undo. List creation/deletion remain non-reversible pending archive/restore governance. History is invalidated automatically after any independent column revision.
4. New permission-checked, no-store endpoints `GET /api/lists/:listId/saved-history` and `POST /api/lists/:listId/saved-history/{undo,redo}`; manage permission for reversal. Shared Board invalidation/realtime Activity on success; server revision/source operation evidence included.
5. UI context actions *Undo/Redo my last saved column edit* load history **only on demand** to avoid per-column background polling. Actions pause while offline, reconnecting or resolving queued Board work, preserve current view and provide explicit conflict/no-history feedback.
6. Offline sync fallback lease does not flush work when localStorage fails, does not renew an expired/foreign lock during delayed heartbeats, and checks current leadership before queued uploads and mutations. Native browser Web Locks path remains preferred. **The localStorage fallback is not an atomic cross-tab lock**; this pass does not claim multi-tab replay certification. Server idempotency/revision protection stays mandatory.
7. The older Node22 test harness for Board workflow was updated to load the actual TS repository and its new helper through TypeScript transpilation, so the prior 26 tests remain executable without adding runtime `.js` compatibility shims.

## Contracts and boundaries

- No new global history engine; the List implementation follows the existing Card saved-operation pattern.
- No automatic reversal of Card lifecycle changes, external integrations, list deletion or other users' edits.
- Error `P2034` surfaces as a conflict with no partial success.
- Deleting a List cascades its metadata-history records. Historical actor IDs are evidence, like existing Card history; erasure continues to pseudonymize user identity and preserve authorized work evidence.
- Existing source-only tests do not prove real DB migrations, contention behavior, browser/Qt accessibility, OS-level file storage, or Web Locks availability on every client.

## Files

- `apps/server/src/domains/boards/board-list-saved-history.ts` (new, authoritative history semantics)
- `apps/server/src/domains/boards/{board-repository,board-service,board-routes}.ts`
- `apps/server/prisma/schema.prisma` and migration `20261025000000_td6_g25_board_list_saved_history`
- `packages/renderer/src/features/boards/BoardWorkspacePage.tsx`
- `packages/renderer/src/core/offline-runtime.ts`
- `tools/scripts/cluster-td6-g25-ws15-{column-history,column-routes,sync-leadership}-tests.mjs`
- `tools/scripts/cluster-0534-board-workflow-tests.mjs` (Node22 transpile adapter)
- `package.json`, `CURRENT_CHECKPOINT.md`, `SOURCE_FILE_MANIFEST.sha256`

## Next G25 closeout targets

- Reconcile Board/List archive/restore against Ticket/QA/Project-linked entities. Permanent deletes and external ties must never be pretended reversible.
- Prove disconnected editor replay and multiuser permission revocation under live browser/PostgreSQL conditions; defer full **runtime** certification until after TD7, but continue source contract coverage now.
- Audit Forms/Project/Build/QA/Review/Calendar integration one last time for divergent state/authority rules, then make a measured G25 **source-only** closeout decision. No invented percentage or irreversible release promotion.
