# Cluster v0.536.0 | Assigned source-review workflow completion

## Connected source behavior

- **My Work → exact review:** Assigned source reviews navigate to the specific review inside Project → Source, not a generic Project overview. Existing authorization remains responsible for visibility. Source review focus restores after URL navigation or an inspector event, scrolls the review into view and exposes discussion/decision controls in context.
- **Accurate attention queue:** A reviewer comment alone does not resolve an assigned review; only approval or requested changes clears that user's action. Source-control events refresh My Work through the existing debounced event path.
- **Partial-load resilience:** If Source Reviews, Personnel Records or Required Knowledge fail to refresh, existing queue data is retained and the Attention screen identifies unavailable feeds with Retry instead of reporting a falsely empty queue.
- **Decision integrity:** Requesting changes requires a note both in the UI and server input/service validation; duplicate identical sequential review decisions do not generate a second activity event. The existing prohibition on approving one's own review remains intact.
- **Draft preservation:** Failed commit/review-creation/review-decision requests do not wipe unsent text or reviewer selections. A synchronous operation lock prevents double submission during the same render turn.
- **Navigation recovery:** If a requested review is no longer visible to the viewer, the source page explains that safely rather than displaying stale details. Focused review has keyboard-focus and a visible outline.

## Evidence

- v0.536 focused semantic/navigation and source-contract checks: **17/17 passed**.
- Inherited v0.535 Board three-way 21/21, v0.534 Board 26/26, v0.533 Library 30/30, v0.530 Work/Library/Admin 18/18. Together **112/112 selected checks passed**.
- TS/TSX syntax: 1,026 files, zero parse diagnostics. CSS: 108 files, zero delimiter errors. Renderer relative references: 3,044, zero unresolved.
- No Prisma schema migration or native file-updater modifications.

## Limitations

- Current review decisions still use the existing service/project permission authority. This pass does not introduce a new review-assignee-only authorization policy or a general review subsystem.
- Idempotency check prevents sequential same-request duplicate activity; it is not a database-atomic operation-key guarantee under simultaneous multi-process races.
- React/browser focus, live PostgreSQL authorization and concurrent writes, Windows native behavior and full dependency-backed builds are **not certified**. Server Zod/Prisma paths receive source-level regression coverage, not a live database test.
- Persistent server Undo/Redo, broader People/Admin/Library completion, automatic file-update policies and runtime certification remain open.
