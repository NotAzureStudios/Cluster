# TD4 R33 | Server-authoritative Manual + Smart Collection selection

## Confirmed source gap

R32's complete 200-item server selection was available only for Library workspace search. `LibraryWorkspacePage` disabled the same operation inside Collections, despite collection browsing being paginated and shared via separate viewer/editor grants. A collection containing unloaded files could only select the current page, and no collection-owned selection snapshot existed.

## Complete implemented request-to-mutation path

1. Users open a Manual or Smart Collection (owned, granted viewer, or granted editor). Select matching is available without browser pagination prefetch.
2. The UI submits `POST /api/library/collections/:collectionId/select-matching` with `expectedCollectionRevision`. It binds the reply to the originating query key, navigation request sequence and original collection revision, then installs the exact returned item list and revisions.
3. The server checks Library tool/view and Collection grant first, then inside one RepeatableRead transaction re-reads the collection's current grant/archived/revision and resolves the same Manual memberships or Smart query and folder scope used by its normal browse endpoint. Both use stable paging order.
4. Every page applies Personnel Records exclusion, destroyed-object exclusion and the independent canonical Library item/view ACL. Unauthorized items are never serialized. Collector refuses 201+ visible matches, invalid/duplicate IDs or revisions, scan exceeding 20,000 raw records, or ambiguous transaction conflicts. No partial result is issued.
5. The existing `captureLibraryBulkRevisions` → `/api/library/bulk/preview` → `/api/library/bulk` operation remains untouched. It rechecks mutation rights, Personnel Records, active locks and item revisions, and commits the bounded write transaction separately. Selection is never treated as a write grant or persistent bearer token.
6. Same-query collection refresh preserves the user's reviewed selection, while navigation/filter/collection revision changes invalidate it. All bulk and export behaviors remain capped at 200.

## Executed development evidence

- 31/31 `cluster-0540-library-completion-tests.mjs` tests including live handler invocation for owner/granted viewer/ungranted actor, revocation at transactional re-read, stale revision, Smart scope, Manual membership, Personnel Records and 201-item overflow.
- 21/21 inherited R32 matching-selection tests, R31 grant behavior and TD3/Forms regressions retained (see validation JSON).
- Grammar/source/CSS checks and ZIP/patch manifest verification are development checks, not proof of live PostgreSQL, browser or Qt behavior.

## Explicitly out of scope

This does **not** implement durable bulk jobs for thousands of files. The current 200-item write limit remains intentional: a safe large-job implementation needs queue ownership, resumable per-record checkpoints, cancellation semantics, audit and rate/authorization rechecks before or during writes. User-specific filter-bar values on a Collection page are not silently merged into its saved Smart query; the selection mirrors the actual Collection listing.
