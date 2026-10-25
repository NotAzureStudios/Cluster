# Cluster 0.528.0 | Board and Library workflow closeout

## Implemented

### Board Work
- Card moves/reorders now enter a bounded (30-operation) per-session undo/redo stack rather than the previous one-shot move recovery notice.
- Server-side expectedRevision remains authoritative for each replay. A 409 discards only the affected card's local move history and refreshes the Board.
- Repeated moves of the same card update their own expected revision after a successful undo/redo. Queued offline moves clear local history rather than creating an unsafe replay chain.
- Board move history has visible Undo/Redo counts and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z shortcuts, without stealing typing or dialog shortcuts.
- Five Board bulk actions (priority, assignment, due, defer and move) now use one sequential executor with progress, explicit applied/queued/skipped/failed counts, duplicate-call protection, retry selection of failed cards, and impact confirmation for batches of 20+.
- Board bulk remains individually revision-checked and **not atomic across cards**. Failures are never presented as total success.

### Library Work
- Bulk actions now snapshot selected IDs and revisions, preview material moves/Trash/Restore, and confirm batches of 25+ even for organization changes.
- Duplicate requests are blocked synchronously until confirmation or mutation completes.
- Added `Select loaded` limited to 200 explicit current results (server's bulk limit) and `Copy IDs`. Unloaded pages are not silently included.
- The server requires expectedRevisions and performs each item update with revision compare-and-swap in a single Prisma transaction. A stale row rolls back the entire batch with HTTP 409 rather than overwriting a coworker's edits.
- Existing permissions, protected-folder checks and activity logging remain in place.
- The shared confirmation dialog now preserves newlines for legible previews.

## Explicit limitations
- Undo/Redo is scoped to card moves/reorders in the active Board session, **not** a universal edit history for all Cluster workspaces. No replay across page reloads or conflicting remote edits.
- Board bulk operations remain one authorized mutation per card and can partially succeed, queue, or fail. A server-wide atomic Board bulk API is not included.
- Library bulk has a hard limit of 200 selected IDs; no cross-page 'all matching' update. The confirmation summarizes loaded selected item titles, not a recursive child impact analysis.
- No runtime PostgreSQL, Windows/Qt or full dependency-backed app certification, per feature-first direction.

## Follow-on roadmap
- Generalized command history for Board metadata, Library edits, Timeline objects and forms; collaboration-safe shared history.
- Relationship/backlink UX, Library bulk preview of recursive folder impacts, rich admin action explanations and command-palette coverage.
- Saved Desktop file-update destinations, automatic file-update policy and differential transfer.
