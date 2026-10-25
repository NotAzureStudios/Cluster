# TD4 R35 | Collection-aware durable Library metadata operations

## Work completed

The R34 server-owned `/api/library/bulk/jobs/preview` and `/api/library/bulk/jobs` workflow accepts **one** source: either an explicit Library workspace query or `{collectionId, expectedCollectionRevision}`. It continues to accept only `tag`, `untag`, or explicit `pin: true/false`. Server selection checks current user account status and permissions within repeatable-read. For Manual Collections, every member is walked in its stored order, not merely currently rendered pages; Smart Collections compile their saved query and validate an optional descendant-folder scope. Collection owners/editors (and authorized admins) can request jobs; shared viewers cannot. Each file is independently filtered by Library contribute authorization and Personnel Records protection.

Preview returns a complete up-to-1,000 eligible ID/revision snapshot digest. Queue re-resolves the same scope/revision and rejects stale previews. The existing request-key deduplication includes the collection identity and revision, and the immutable worker payload stores the reviewed collection. The worker rechecks live collection edit role, archived flag and exact revision **inside each serializable 20-item transaction**, alongside existing user/account, item permissions, Records, locks and revision gates. If the collection changes or the grant is revoked, future chunks are counted inaccessible, not written; prior committed chunks and their activity/checkpoint evidence remain durable. Chunk activity references the reviewed collection.

In Library UI, collection owners/editors can access the same background tagging/pinning menu and status/cancel panel. A queued intent freezes the original collection ID and revision and refuses navigation changes between prompt, preview and confirmation. The separate 200-item interactive flow remains intact.

## Safety boundaries and remaining work

The asynchronous workflow is bounded to 1,000 accessible items and 20,000 scanned candidates, is **non-destructive metadata-only**, and is not an unbounded file mover, archiver or deletion engine. Permission changes during processing can produce partial results, intentionally. Jobs do not need to undo completed chunks. Collection revisions changing during processing will deny future chunks rather than adapt a prior selection to a different query. The UI must communicate these counts.

The R34 migration and existing BackgroundJob queue are reused; **no new Prisma migration**. Installed Windows native executables unchanged. Still outstanding: large tree/move/archive/delete durability, typed provider events and canonical resource adapters, release testing against PostgreSQL, full dependency compilation, multi-user/browser and native Qt/Windows. TD3 remains source-closed.

## Development evidence

Executable tests cover 620-member Manual Collections across pages, viewer/editor/owner authorization, grant revocation, stale collection revisions, protected attachments, Smart query evaluation, 1000/1001 boundary and malformed Smart JSON. Worker transaction tests exercise a 45-item operation whose grant disappears after the first commit and whose remaining 25 records are denied, and an outdated collection revision where no item mutates. Inherited TD3/Forms/Library regressions and source scans are tracked in `TD4_R35_SOURCE_VALIDATION.json`.
