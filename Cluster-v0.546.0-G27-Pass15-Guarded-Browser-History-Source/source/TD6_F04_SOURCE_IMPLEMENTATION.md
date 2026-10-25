# TD6 F04 — Whiteboard saved operation history implementation

## Change summary

- Durable `WhiteboardOperation.historyBefore/historyAfter` metadata (nullable, max 64 KiB UTF-8 per snapshot) plus state and reversal linkage.
- Canonical operation types reverse-safe in F04: `element.move`, `element.resize`, `element.patch`, `group.set`, `batch.transform`. Missing targets, oversized data and no-op edits are non-reversible. Other operation kinds remain unchanged and are not silently declared reversible.
- Scoped history GET returns operation metadata only for the current author; never exposes pre/post snapshots. POST undo/redo rechecks the current contributor permission and strict original-actor identity.
- Each reversal creates an internal `history.restore` operation, increments the authoritative Whiteboard revision/sequence transactionally and publishes realtime changes. Normal mutation batches cannot submit the internal kind.
- Conflict guards: original history state, logged intervening operations, exact contiguous retained sequence, `$document` collision, full current element snapshot equality, locked element access, missing targets and revision CAS.
- Restore operations participate in 50-operation snapshot cadence. All original audit and activity evidence remains.
- Renderer reads server-owned history on Whiteboard selection, refreshes it after successful saves, provides saved Undo/Redo alongside existing local draft Undo/Redo, and does not queue offline reversal requests.
- Prisma migration is additive only for saved Whiteboard operation history; no storage destruction enabled.

## Focused development evidence

- `tools/scripts/cluster-td6-whiteboard-saved-history-tests.mjs` exercises pure capture/restore, the production route handlers under an in-memory transaction adapter, normal operation POST → history → reversal, concurrency/conflict cases, and renderer/server boundary invariants.
- F01 branching, F02 deadlines, F03 Card saved history, TD2 collaboration ownership, TD5 P13 committed outcome checks, and the Board workflow regressions are inherited source-level checks.
- These tests are NOT a substitute for generated Prisma client compilation, real PostgreSQL transactions/migration, authenticated multi-actor Chromium or Qt execution, or Windows runtime certification. These remain deferred by user direction.
