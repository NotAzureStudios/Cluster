# Cluster TD4 R40: Read-only Library orphan evidence audit

**Baseline:** v0.546.0 TD4 R39. TD3 remains source-closed. TD4 remains open.

## Scope implemented

- A new administrator-only `POST /api/library/storage/orphans/audit` creates a `library.storage.orphan-audit` job on Cluster's existing durable background queue.
- Only administrators can retrieve the report using `GET /api/library/storage/orphans/audit/:jobId`. Responses are uncached.
- The job counts current `LibraryItem.fileName`, historical `LibraryVersion.fileName`, and `LibraryDerivative.storagePath` references, with stable ID pagination and a hard upper bound. It then scans the configured Library root without modifying files.
- Entries younger than seven days are tracked separately; older unreferenced paths are **review candidates only**. The result includes counts, estimated candidate bytes and a sample limited to 40 relative paths.
- Indexes and reconciliation temporary files are excluded. Symlinks are not followed; redirected directories, unsafe roots, excessive depth and large inventories fail closed instead of producing a falsely complete report.
- Cancellation and Library tool-disable fences are checked as work advances; TD2 owns the new durable job type.
- Library's admin-visible toolbar can start an audit and monitor status/results, with session-level recovery of the current job ID. No destructive control is exposed.

## Deliberate safety boundary

This does **not** delete, move, quarantine or authorize deletion of anything. A database+filesystem scan is not an atomic snapshot; recently changed references, concurrent jobs and historic publishing/retention rules can invalidate apparent orphan status. The audit does not prove that any candidate is safe to delete. An eventual disposal workflow must validate full resource provenance, holds and retention, external copies, content checksums, DB ownership and concurrent mutations with explicit operator approval. Derivative paths outside the Library root are not part of this scan.

## Development verification

- `tools/scripts/cluster-td4-r40-orphan-audit-tests.mjs`: executable filesystem and worker tests (9 cases, including permissions and no-delete boundaries).
- Inherited R37–R39 storage, TD4 selection/bulk/collection and TD2 owned-job inventory regressions executed in Node v22.16.0 with experimental TypeScript stripping.
- TypeScript parser and relative-import syntax scan, and CSS structural scan. See `TD4_R40_VALIDATION.json` for executed counts.

**Not certified:** Full Node 24 dependency-backed compilation, generated Prisma, live PostgreSQL, multi-user/browser testing, and Windows/Qt remain on the separate release-certification roadmap.
