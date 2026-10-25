# TD4 R39 | Library post-commit storage reconciliation queue convergence

## Confirmed source problem

R38 made the bounded interactive **bulk** move enqueue safe, collision-resistant durable Library storage repair, but two user-facing mutations still called `reconcileLibraryStoredFiles()` synchronously after writing their Library row: `PATCH /api/library/:itemId` for a changed parent or folder title, and `PATCH /api/desktop-libraries/:itemId/rename` for a folder. Either path could scan the entire Library during a request, fail *after* a committed edit, and lead a user to retry an already completed mutation. R38's administrator and bulk enqueue paths also independently defined similar queue operations.

## Connected implementation

1. Added `domains/library/library-storage-scheduling.ts` as the canonical post-commit queue adapter. It enqueues the existing `library.storage.reconcile` job, with `createdById`, caller reason, and no new queue/worker type. The returned structured outcome *always* distinguishes committed DB changes from unavailable repair work. It reports the actual returned job status (QUEUED or already-running where relevant), never fabricates queue success.
2. `PATCH /api/library/:itemId` now enqueues repair **only** when the actual parent changes or a folder title changes. Ordinary metadata and file display-name edits do not schedule storage rescans. The 202 response is still the serialized Library item at the root, preserving the existing caller contract, plus `committed`, `reconciled`, `reconciliationJobId` when available, `reconciliationQueued` and an explicit warning. It no longer runs synchronous stored-file reconciliation.
3. The mounted-Library folder rename route now returns a 202 committed/queued (or committed/repair-required) response with the **existing** `{ok:true,item}` shape, preserving the native Qt mount parser. File renames and same-name updates do not schedule a hierarchy scan. Queue ownership is supplied by the already-injected Library route `jobQueue`.
4. Interactive bulk moves and the administrator repair endpoint reuse the same scheduling adapter. The admin endpoint still fails clearly when **no** repair job was enqueued. The per-job read endpoint retains its existing creator/admin access guard.
5. Library Inspector saves understand a committed-but-not-yet-reconciled result. It preserves the saved item, shows the warning instead of unconditional “Changes saved”, stores the returned job ID for session recovery, and displays the existing repair status widget.
6. Corrected TD2's old Library-owned-job assertion list and handler inventory to include the already-implemented `library.storage.reconcile`. Updated R37/R38 inherited tests to validate the shared scheduler rather than requiring inlined queue code.

## Important scheduling race avoided

Do **not** deduplicate all repair jobs merely by user. R38's repair worker paginates by item ID; if a later edit occurs after an active worker has passed that item's ID, merging into the active job could permanently miss the later edit. R39 queues **each committed mutation** independently. Exact-intent idempotency would require a durable *mutation identity*, not a generic user key. This may schedule multiple scans when a user makes many edits; bounded/coalesced scanning that guarantees revisiting newly dirty ranges remains future work.

## Development evidence

- 11/11 new focused executable scheduling integration checks: positive/negative/uncertain enqueue, job scope, distinct mutations, mounted response compatibility, UI progress, source call sites, and no HTTP-side full file scan.
- Inherited R37, R38, Library selection, collection, durable metadata, and TD2/TD3 owner tests run under the available Node 22 development toolchain with `--experimental-strip-types`. Two inherited tests requiring imported TypeScript used a **temporary** symlink to the installed toolchain, removed before packaging.
- Source scan: 1,023 active TypeScript/TSX files, zero syntax diagnostics; 110 CSS files, zero parser failures; 3,151 renderer relative imports, zero unresolved authored imports.
- This is source-level development evidence, **not** proof of the installed Qt client, PostgreSQL transactional behavior, Node 24 full compilation, or authenticated multi-user use.

## Remaining source TD4 / release gates

- Library old-copy/orphan audit and safe cleanup, with version/blob owners, legal holds and retention analysis. No unattended deletion in R39.
- Durable hierarchy-tree move/Trash/archive orchestration, eventual repaired-file replay, and mounted/external storage provider integration beyond the local-R38 reconciler.
- Cross-provider canonical resource/action/search adapters, typed events, and lifecycle integration.
- Post-commit activity evidence for single-item and mounted-Library edits is still emitted by an existing separate `logActivity` call; it is not transactionally coupled to those writes. This requires its own audit/authority follow-up rather than claiming all durability has been solved.
- Dependencies and generated Prisma client, live PostgreSQL, Windows/Qt, user authorization/browser and production performance acceptance remain on the separate release-certification roadmap.
