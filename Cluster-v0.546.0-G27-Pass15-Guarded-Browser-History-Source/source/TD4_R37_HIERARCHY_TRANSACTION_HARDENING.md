# TD4 R37 | Library hierarchy writes: transactional authorization and partial-commit feedback

## Grounded defect and implementation

The existing *bounded interactive* `/api/library/bulk` move/archive/Trash/restore workflow checked the selected items, destination, folder descendants, edit locks and Records attachments before its Serializable write transaction. A permission revocation, newly protected descendant, destination move, account offboarding or new active lock between that preflight and the write could leave the transaction acting on an out-of-date authorization/topology snapshot. The separate post-commit storage reconciler also ignored some failed file relocations, while a thrown reconciliation error turned a committed database move into a false HTTP failure.

R37 does **not** add a second job system, enlarge the existing 200-root interactive operation, or claim to finish TD4 hierarchy workflows. It hardens the existing complete user journey:

1. Keep the existing preview (with recursive impacted-item count and confirmation), and do the existing initial request checks.
2. Before any write, inside the **same Serializable transaction**, reload the active initiator, selected items and expected revisions, current item contribution ACL, destination parent chain (bounded to 256 hops), bounded descendants (5,000), managed-folder restrictions, Personnel Records references and edit locks.
3. Deny cycles, inaccessible/archived/trashed destination parents, newly protected descendants and access/revision conflicts with stable error codes. The selection's root revisions are still compared-and-swapped on every update.
4. Commit activity evidence in the same transaction as the hierarchy write, so an activity insert failure cannot produce an unlogged successful hierarchy update.
5. After a committed move, reconcile stored-file locations. File reconciliation now reports unresolved relocations instead of quietly succeeding. A thrown or incomplete reconciliation produces an HTTP 202 `{ok:true, committed:true, reconciled:false}` response with `LIBRARY_BULK_MOVE_RECONCILE_REQUIRED`, not an HTTP 500 that invites a duplicate move. The Library UI displays the warning and clears the completed selection.

## Source owners

- `apps/server/src/domains/library/library-bulk-transaction-guard.ts`: authorization + tree invariant validation inside the write transaction
- `apps/server/src/domains/library/library-routes.ts`: transaction integration, atomic hierarchy ActivityEvent, committed-but-reconciliation-pending API response
- `apps/server/src/core/data-layout.ts`: explicit unresolved file counts while preserving the original recoverable `fileName`
- `packages/renderer/src/features/library/LibraryWorkspacePage.tsx`: committed/partial outcome feedback
- `tools/scripts/cluster-td4-r37-hierarchy-transaction-tests.mjs`: executable isolation and real temporary-file reconciliation cases

## Exact boundaries and remaining work

- This is **interactive** bounded hierarchy hardening, not asynchronous 1,000+ item tree movement. Background archive/unarchive remains file-only, up to 1,000 matches.
- Serializable database consistency does not turn physical filesystem renames into a distributed transaction. Unresolved moves are identified and surfaced, not automatically rolled back. A separate durable repair/retry and collision policy is still needed.
- Folder archive/Trash updates operate on selected roots in the existing route while the descendant scope is inspected and authorized. The existing workflow's lifecycle semantics are preserved; this pass does not create a new recursive per-descendant state transition.
- A complete dependency-backed Node 24 build, real PostgreSQL SERIALIZABLE contention testing, browser/multi-user permission races and Windows native/device certification remain exclusively in the release certification roadmap.
- TD3 remains source-closed. TD4 remains open for true tree-wide lifecycle jobs, safe file-transfer/move durability, shared resource/action/search adapters, typed provider events and provider lifecycles.
