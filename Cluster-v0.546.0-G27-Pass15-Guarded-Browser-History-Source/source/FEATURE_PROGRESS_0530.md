# Cluster 0.530.0 | Work, Library, Administration

## Completed source implementation

### Board Work
- `executeBoardBulk` reports exact IDs applied, queued, skipped, failed and not yet started, along with accurate counts.
- Supports AbortSignal checked *before* each new mutation, preserving in-flight results rather than cancelling already sent writes.
- UI offers Cancel remaining while processing. Failed and not-started cards remain selected for deliberate retry; queued offline actions are distinguished from applied actions.
- Only cards actually applied/queued lose move-history entries; failed, skipped and untouched cards retain valid history.

### Library
- Bulk `untag` uses the same guarded, Serializable revision-CAS mutation path as existing bulk tagging.
- Bulk toolbar exposes Remove Tag, Archive and Restore operations using existing server preview and permission checks.
- Manual collections can accept multiple selected Library items and remove selected references in one action. Addition checks item visibility and revision, rejects inaccessible or missing items instead of silently partially applying, then atomically writes membership and advances the collection revision. Removal validates the owner, manual collection state and collection revision before deleting references atomically.
- Stale membership edits report 409. Duplicate additions do not create duplicate memberships; stale retry requests receive a revision conflict, and the API returns the number newly added or removed. No Library originals modified.

### Admin
- Pending approval triage sorts by priority then age, oldest first, or newest first; resolved history stays after pending work.
- Next-in-queue shortcut and automatic focus progression after an acknowledged decision. Filtered-out detail cannot remain selected in the visible inspector.

## Not claimed complete
- This is not a universal Undo/Redo engine, and Board bulk actions remain individual server requests (partially successful batches are possible).
- Collections remain owner-scoped, not shared collaborative objects; collection ACL checks are source-implemented but PostgreSQL concurrency tests are outstanding.
- No cross-page all-matching selection, no complete revision rollback for Library bulk, and no end-to-end multi-user runtime certification.
- The OS file updater, Packets, native Qt/Go integration, Windows/DB certification were not modified this pass.
