# Cluster 0.529.0 | Library bulk impact and Admin approval consistency

## Implemented

### Library bulk operations
- Added a server-side, capped (5,000 descendants) nested-folder impact traversal. The preflight counts all additionally affected descendants, without dumping restricted item titles into the browser.
- The Library bulk UI fetches authoritative preflight data **before asking for confirmation** when moving, archiving, trashing or restoring items, and displays selected + nested counts. If preflight fails, no mutation is submitted.
- The real mutation independently repeats permission, selected-revision and nested-scope checks instead of trusting preflight results. Bulk remains one revision-CAS transaction at Serializable isolation for selected rows.
- Enforces *contribute* permission on a bulk-move destination, validates its active folder state, and checks all selected cycles with one hierarchy read, not one database-wide scan per item.
- Prevents duplicate selected IDs, prevents `status` from bypassing dedicated Archive/Trash actions, and requires explicit tag/status/pinning values. Bulk approved status now maintains approval timestamp consistency.
- Blocks nested operations containing protected managed folders, inaccessible descendants, Personnel Records attachments or active edit locks. Root selections are subjected to the same record/lock checks.
- Provides explicit errors for overlarge hierarchies and stale selections. No schema migration.

### Admin approvals
- Both avatar review endpoints now call the same transactional, one-time pending-state authority. Double decisions return HTTP 409; rejecting a superseded avatar never restores the stale picture over the user's newer upload.
- Approval Center prevents double-submits before React rerenders, discards superseded fetch results, resets decision notes on selection changes and confirms high-impact external-release / Project completion decisions.
- Fixed the approval dashboard's “3+ days” control so it **actually filters** aging pending approvals, rather than just resetting unrelated filters.

## Focused validation
- `node --experimental-strip-types tools/scripts/cluster-0529-library-admin-assertions.mjs` covers bounded scopes, nested access/protection, confirmation-contract consistency and a mock transactional avatar decision/replay test.
- All inherited tests listed in `CLUSTER_0529_VALIDATION_RESULTS.md` and source scans pass.

## Important limitations
- Recursive impact is an informational snapshot. The mutation independently rechecks data, but live PostgreSQL concurrency/phantom-child scenarios still need runtime tests, and the folder hierarchy does not create a single SQL-level atomic graph snapshot.
- Only explicitly selected rows are individually mutated; descendants can be affected by ancestor location/lifecycle. A full audit/dry-run for all downstream references is still future work.
- No generalized undo outside Board card moves, no cross-page all-matching Library bulk mutation, and no complete multi-user UI certification.
- Qt, native file-update helper, PostgreSQL setup, and production certification were intentionally not changed or rerun in this pass.
