# TD4 R38 | Durable Library storage reconciliation: source implementation

## Starting defect

R37 made the interactive Library hierarchy *database* mutation serializable and atomic with audit evidence, but its post-commit storage path still used a whole-Library synchronous loop and `fs.rename` for physical files. An existing destination could be overwritten on some systems, and a request could time out even though the hierarchy change committed.

## Implemented connected path

1. After the authorized bulk `move` transaction commits, enqueue `library.storage.reconcile` through `BackgroundJobQueue`; never interpret an enqueue failure as a DB rollback. Return `202` and `committed: true` with a repair ID when available.
2. The existing TD2 tool ownership gate controls `library.storage.reconcile`; suspend/resume follows the Library tool switch. This is *system maintenance of a prior committed action*, so it runs even if the original user is later suspended. Users cannot request unaudited file moves through the maintenance endpoint.
3. Repair reads the Library in 50-file batches and checks cancellation/tool availability between batches. A worker crash restarts its idempotent full scan rather than relying on a nontransactional cursor.
4. Each candidate validates its source under the storage root and ensures neither symlink traversal nor path escape can redirect operations. It copies to a unique destination temporary file, verifies its hash against the source (and the stored checksum when present), and claims the canonical destination exclusively using `fs.link`. No `rename` over an existing destination.
5. The DB's `fileName` pointer is switched only through `updateMany` conditioned on the previously observed `fileName` and `parentId`. A failed CAS removes only a destination created by this attempt; an uncertain DB outcome retains both copies. Existing destination recovery requires verified bytes and no other record owning the path.
6. After a successful pointer change, the previous physical copy remains recoverable because unlinking it cannot be made atomic with a competing DB move. **Storage orphan cleanup is explicitly not implemented**; it needs ownership/references/hash audit, and operators should monitor disk capacity.
7. Admins may POST `/api/library/storage/reconciliation` for recovery, and admins/original move initiators can GET its status. Library displays queued, running, succeeded-with-unresolved, and failed states, without inviting a second hierarchy mutation.

## Source evidence

- `apps/server/src/core/library-storage-relocation.ts`
- `apps/server/src/core/data-layout.ts`
- `apps/server/src/domains/library/library-storage-jobs.ts`
- `apps/server/src/domains/library/library-routes.ts`
- `apps/server/src/domains/jobs/job-tool-ownership.ts`
- `apps/server/src/app/cluster-server.ts`
- `packages/renderer/src/features/library/LibraryWorkspacePage.tsx`
- `tools/scripts/cluster-td4-r38-storage-reconciliation-tests.mjs`
- Updated R37 physical-reconciliation harness and TD2 owned-handler inventory.

## Outstanding concerns and exit boundary

- This **does not** make bulk moves larger than the existing interactive limit or implement durable multi-tree lifecycle moves/Trash/destruction.
- Other storage routes, including mounted-Library folder renames, still invoke the reconciler synchronously and need an explicit follow-on conversion; they benefit from collision-safe behavior but not the new job delivery path.
- Previous path copies and abandoned temporary files need a safe audited garbage-collection workflow, not blind deletion.
- Native Windows behavior, live PostgreSQL concurrency/migrations, full Node24 dependency-backed compilation, and multi-user authorization are release-certification tasks, not proven by source scans.
