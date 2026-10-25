# Cluster v0.527.0 | Desktop destination file updater

## Implemented this batch

- Go `sync-files`: compares the selected and independently signed/current managed release against a user-selected existing folder, copying missing files and replacing older content **only** if its current SHA-256 still matches Cluster's recorded baseline. Unchanged files are skipped; unrelated and removed-from-release files are preserved.
- Go `replace-files`: separate opt-in native action for adopting folders with existing conflicting files. Originals are copied into privately retained, SHA-256 checked backups before replacement. This action intentionally can replace local edits and therefore requires an extra native warning/confirmation.
- Go `rollback-files`: restores preimages from the most recent tracked update only if no later edits have changed the managed destination bytes; rejects untracked or unsafe rollbacks.
- Private destination state and per-operation journals, file hashes, safe temporary copies, update concurrency lock, pending-recovery journal and post-operation file verification. No executables are started and no applications or OS services are installed.
- Qt Desktop now prompts for the signed kit and an **existing** destination folder using native pickers. It never accepts destination paths, overwrite decisions, signing fingerprints or trust assertions from renderer payloads. It runs the Go helper asynchronously and reports separately whether the operation previewed, updated or rolled back files.
- Desktop Account Settings exposes destination preview, safe update, explicit backup-and-replace, and guarded rollback. A fresh authorized target feed check precedes each operation. Existing private managed-content selection still requires its separate server-signed deployment grant.

## Targeted validation

- Go tests pass, including new managed update, conflict, first-time adopt/restore, interrupted update recovery, symlink, repeated operation and rollback-edit guards.
- Windows x64 Go helper cross-compiles. **Not executed on Windows.**
- 16/16 Desktop integration source assertions pass. Both edited TypeScript/TSX renderer modules parse successfully.
- Qt source inspected/linked in source, but no Qt toolchain, full application build or Windows runtime execution took place.

## Remaining functional work

- Automatic/background update scheduling and differential network download; current signed Package ZIP transfer remains full-artifact and explicitly user-triggered.
- Destination mapping presets/settings and history UI; current folder selection happens on each operation.
- Pruning of old private backup snapshots after approved retention, optional managed removal of obsolete files, polished restart/recovery UI.
- A multi-file update is **journal-backed, not atomic as one filesystem transaction**. Interrupted operations may leave partial files until the next recovery attempt. If a user modifies a partially updated file, recovery fails safe rather than overwriting it.
- No full Node/Prisma/PostgreSQL build or Windows/Qt certification in this feature-only pass, per project direction.

## Native actions

`--action preview-files | sync-files | replace-files | rollback-files`

All require independently trusted signed release input, the current verified managed selection, and an existing destination outside Cluster's private storage. The destination state is bound to the canonical absolute folder path and Package key.
