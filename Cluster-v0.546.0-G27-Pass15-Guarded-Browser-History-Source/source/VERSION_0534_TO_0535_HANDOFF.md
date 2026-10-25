# Cluster v0.534 → v0.535 handoff

**Source baseline** `Cluster-v0.535.zip`, built directly from `Cluster-v0.534.zip`. Existing Windows Go file updater binary is preserved byte-for-byte. No migration.

## Important implementation

- `apps/server/src/domains/cards/card-routes.ts`: permission-checked canonical Card GET for latest-conflict review, no-store response.
- `packages/renderer/src/features/boards/board-card-conflict-resolution.ts`: pure field-by-field three-way comparison, deterministic nonoverlap merge, explicit conflict choices, defensive array cloning.
- `packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx`: Card 409 recovery UI, anchored original baseline, reviewed version adoption without immediate Save, fresh retry guard, fixed header close path, unload protection, Card metadata Save no longer supplies `listId`.
- `packages/renderer/src/features/boards/board-workspace.css`: scrollable conflict-review layout.
- `tools/scripts/cluster-0535-card-conflict-review-tests.mjs`: 21 semantic/contract checks.
- v0.534 Board test expectations updated only where the old pinned-revision-only model became explicit reviewed-rebase behavior.

## Avoid reimplementing existing subsystems

Whiteboard already has operation-based collaborative Undo/Redo. Board Card move history, local draft Undo/Redo, Library collections and bulk rename, authenticated signed Package delivery/file updater already exist. Audit before recreating them.

## Next milestone

Finish complete remaining Work review and cross-resource approvals or move into end-to-end People/Admin/Library workflows. Avoid micro-passes and new architecture unless the existing authority truly cannot support the function. Certification (Qt/Windows, PostgreSQL, browser, security/load) remains deferred by explicit request, but meaningful functional tests are still required.
