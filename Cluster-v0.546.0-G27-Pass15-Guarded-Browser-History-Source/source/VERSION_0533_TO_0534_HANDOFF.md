# Cluster 0.533 → 0.534 handoff

**Trusted source baseline:** `Cluster-v0.534.zip`. Derived directly from `Cluster-v0.533.zip`. Native Windows Package Go binary preserved byte-for-byte. No database migration.

## Changed implementation

- `packages/renderer/src/features/boards/board-card-draft-history.ts`: bounded immutable local draft Undo/Redo.
- `packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx`: Card editor draft history UI/shortcuts, pinned expected revisions, duplicate-submit locking, refresh-in-place for secondary Card actions, Board/column management revision and operation guards.
- `packages/renderer/src/features/boards/BoardWorkspacePage.tsx`: editor keyed by Card ID; refresh Card detail with authorized canonical Board read after secondary actions.
- `apps/server/src/domains/boards/board-repository.ts`, `board-service.ts`, `board-routes.ts`: revision-qualified transactional deletion plus stale-delete conflict responses.
- `tools/scripts/cluster-0534-board-workflow-tests.mjs`: executable draft-history tests, mock transactional delete behavior and cross-layer revision/UI contract checks.
- `tools/scripts/cluster-0534-static-scan.mjs`: TS/TSX parse, CSS brace balance and renderer relative-import scan.
- Canonical version, validation report, ledger, roadmap and source manifest updated.

## Next completion milestone

Do not redo Board move history, Whiteboard collaborative undo, existing Library smart collections or the signed Package file updater. Prioritize **remaining shared Work review/approval and collaboration UI**, or complete Desktop explicit background update-policy flow, preserving native confirmation and authorized rollout semantics. Avoid building an OS software installer. Test and document actual behavior, and do not call runtime certification complete.
