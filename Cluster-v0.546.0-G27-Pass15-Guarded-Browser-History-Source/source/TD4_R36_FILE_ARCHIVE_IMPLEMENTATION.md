# TD4 R36 | Durable standalone Library Archive and Unarchive

## Exact implemented user journey

Library folder/search or Manual/Smart Collection → Background actions → Archive matching files / Restore archived matching files → server preview of **complete eligible** match count and digest → explicit confirmation → idempotent queue submission → durable 20-item chunks → progress/cancel and partial/conflicted counts.

- Archive sets `LibraryItem.status = "archived"`. Unarchive sets `status = "active"`. `lifecycleState`, `deletedAt`, retention, blob/storage paths and actual contents are untouched. This is explicitly *not* a Trash restore operation.
- Eligibility is computed in the authoritative repeatable-read selection transaction. Access to the Collection does not grant file access. Protected Personnel Records attachments are never selected. Folders, parent-bearing items, destroyed/trashed/deleted records, and items whose status is already at the target value are not counted as eligible.
- Each worker chunk independently rechecks the current initiating account and expiry, Collection edit grants and revision, item contribution ACL, Personnel Records attachments, active asset locks, any children, lifecycle/status, and CAS revision; it cannot execute on an old grant or stale item. Conflicted/denied/blocked/no-op counts remain separate.
- The job uses the **existing** `library.bulk.metadata` queue type, its dedupe index and `LibraryBulkCheckpoint` table. No new queue or migration. The background action is recorded with `library.bulk.lifecycle.chunk` activity event type and action/count metadata in the *same transaction* as item updates and checkpoint.
- A lost result or worker lease interruption replays only uncommitted chunks. Cancellation stops at a chunk boundary. Already committed operations are not rolled back, so the UI explicitly warns of partial completion.

## Verified cases / boundaries

Execution tests cover a non-folder with children, true folder, protected Personnel Records, locked item, deleted/trashed/destroyed item, already-archived no-op, archived-only restoration, and loss of progress acknowledgement after a committed chunk. Existing tests additionally cover account offboarding, revoked collection editing, stale revisions, audit insert rollback and 1,000/1,001 selection boundaries. The full inherited regression run is recorded in `TD4_R36_SOURCE_VALIDATION.json`.

**Intentionally not implemented:** destructive Trash/purge, folder/tree archive and restore, folder moves/reconciliation, lifecycle dependents, schema migration, actual Windows binary changes, live PostgreSQL or authenticated multi-user browser acceptance. Those requirements remain assigned to TD4/TD5/TD6 or the release certification roadmap, not implicitly certified by source tests.
