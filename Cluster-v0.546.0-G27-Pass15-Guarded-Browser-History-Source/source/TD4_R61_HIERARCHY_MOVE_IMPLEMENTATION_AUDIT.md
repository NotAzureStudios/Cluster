# TD4 R61 | Durable Library hierarchy move implementation evidence

## Scope and rationale

Before R61, the interactive `/api/library/bulk` handler could atomically update at most 200 selected roots with descendant access checks, but a large folder selection had no durable multi-chunk progress/recovery workflow. The existing `library.bulk.metadata` job explicitly excludes tree mutations. R61 adds **one specialized handler** to the existing durable job worker/checkpoint mechanism, not a second generic scheduler.

## APIs and data ownership

- `POST /api/library/bulk/hierarchy/move/preview` accepts `{roots:[{id,revision}],parentId}` and returns a digest, selected root count and total affected count. The preview occurs in RepeatableRead and traverses up to 5,000 records under current ACLs. The caller must have Library tool edit authority.
- `POST /api/library/bulk/hierarchy/move` additionally requires `digest` and a UUID `requestKey`; it rechecks the full snapshot before enqueue. A previously accepted exact intent is recovered before resnapshotting, because some roots may already have been moved. Queue payload includes root identity, source parent, hierarchy fingerprint and destination-ancestor fingerprint, **not** a bearer authorization token.
- `GET .../:jobId` and `POST .../:jobId/cancel` return only the initiating user's job (404 for others), with per-root committed/unchanged checkpoints.
- New `library.hierarchy.move` durable worker is classified as Library-owned alongside `library.bulk.metadata` and existing storage reconciliation.

## Transaction invariant

For each root not yet marked complete, one Serializable PostgreSQL transaction rechecks the account, current Library ACLs, whole subtree, locks, protected Records attachments, Project membership/scope, managed-folders and destination ancestry. It refuses changed subtree/destination fingerprints. If the source is already in the requested parent, the transaction records an explicit no-op checkpoint and audit entry. Otherwise the transaction commits together:

1. `LibraryItem` compare-and-swap revision and parent pointer update.
2. `LibraryBulkCheckpoint` compare-and-swap cursor advance and count.
3. Attributable `ActivityEvent` with source, destination, root and digest evidence.
4. One **system-owned** queued `library.storage.reconcile` BackgroundJob record under the existing worker type.

The last step is intentionally written to the existing queue's database table *inside* the move transaction; after-commit `enqueue()` cannot guarantee a repair record survives a crash or cancellation in that gap. These direct repair records rely on the existing poll/claim runtime rather than an immediate wake notification, and are classified as Library-owned for disable/re-enable. The real queue and its workspace budget semantics should be assessed against this transactional insertion during live certification before broad deployment.

A transaction rollback leaves none of these writes behind. Progress acknowledgment may fail after commit; the next worker claim reads the committed checkpoint and does not reapply the earlier root. Multiple roots are not a single global atomic operation: cancellation/offboarding/revocation can leave an intentional **partial** result with durable evidence. Physical files are never unlinked by the move handler; the pre-existing storage reconciler safely handles path relocation.

## Checks performed

- `tools/scripts/cluster-td4-r61-hierarchy-move-tests.mjs`: 15 executable tests on transpiled real modules with a rollback-capable simulated Prisma transaction (snapshot stability, ancestor drift, revision drift, overlap, nested ACLs, protected Personnel Records, locks, managed roots, Project boundary, cycles, crash/replay, queued-repair rollback, offboarding, cancellation, bounds, no-op).
- `tools/scripts/cluster-td4-r61-hierarchy-ui-integration-tests.mjs`: seven contract checks across real server route source, composition registration, canonical owner inventory, renderer preview/submit/poll/cancel and partial-commit messaging.
- Inherited `cluster-td2-library-ownership-tests.mjs` and `cluster-td2-worker-ownership-inventory-tests.mjs` now include the newly reviewed job owner. Unrelated 31 selected TD4 regression suites remain green.
- `TD4_R61_REGRESSION_RESULTS.json` and `TD4_R61_SOURCE_SCAN.json` preserve machine-readable test evidence.

## Unverified

These tests are source-level/fixture checks, not a multi-process PostgreSQL transaction test. The package is lean and does not include generated Prisma code or a running Node 24/Windows target. Mandatory acceptance includes competing workers, authorization changes mid-commit, active cancellation while storage repair starts, queued-job budget impacts, actual filesystem reconciliation, and browser/Qt UI interactions at Windows DPI scales.
