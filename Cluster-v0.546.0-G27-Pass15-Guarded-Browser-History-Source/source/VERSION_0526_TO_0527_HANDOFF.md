# Cluster v0.526 → v0.527 handoff

**Source baseline:** complete v0.526 archive. v0.527 is an implementation checkpoint, not certified production software.

## Source changes

- Native Go: `file_update_sync.go`, new tests, CLI `sync-files`, `replace-files`, `rollback-files`.
- Qt: Native Capability Broker provides `package.previewFiles`, `package.syncFiles`, `package.replaceFiles`, `package.rollbackFiles`. Picks kit and destination locally; explicit secondary warning for untracked replacements; validates expected release identity/result.
- Renderer: Desktop capability contract plus Package panel actions with fresh target authorization recheck.
- Tests: Go file synchronization and interrupted recovery, static cross-layer assertions.

## User intent and retained boundaries

**Do not build a Windows software installer.** Packages deliver updated studio assets and configuration files. File updating may replace existing content with private recoverable backups, but never executes a downloaded payload, elevates privileges, registers Windows software, or infers OS health. The signed release and current managed selection remain prerequisites. Untracked collisions are preserved unless the user deliberately chooses backup-and-replace.

## Important unfinished work

Automated update policies, destination presets, true differential network transfer, backup retention, multi-file crash-atomicity, obsolete-file removal policy, actual Qt/Windows tests and broader release certification. These are not blockers for advancing other feature workstreams, but must not be described as implemented.

Next pass should stop dwelling solely on Package plumbing. Advance collaborative Work/Undo-Redo, Library bulk workflows and Admin UX, with Package destination settings/auto updates addressed in another connected batch.
