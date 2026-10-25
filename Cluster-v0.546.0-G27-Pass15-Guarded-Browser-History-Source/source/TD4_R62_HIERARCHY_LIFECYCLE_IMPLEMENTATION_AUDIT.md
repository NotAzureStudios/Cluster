# TD4 R62 | Durable hierarchy lifecycle implementation audit

## Background

Before R62, archive/trash/restore had a misleading tree preflight that considered descendants but changed **only selected roots**. The parent could move to Trash while child records stayed active, and naive folder restore could not differentiate earlier independent deletions. R62 converges these into a provenance-backed, full-tree lifecycle operation. This is intentionally distinct from physical storage disposal.

## Authority and operation semantics

- Caller must have Library tool `edit`, plus recursive descendant `contribute` and current active account access.
- Snapshot: repeatable-read database transaction, 1–24 distinct non-overlapping roots, up to 5,000 records, Project scope consistency, protected/managed folder and lock checks. Digest includes topology, revision, hold/retention and any origin job.
- Archive: mark only currently eligible non-archived/non-trashed rows, storing their previous status and deletion identity. Existing independent archived or trashed records remain unchanged.
- Trash: reject any affected active item with a legal hold or unexpired retention; mark only eligible non-trashed descendants, storing original state and new deletion identity. Files and derivatives are not removed.
- Restore: require a still-open mark on the selected root; consider the origin job and root as the exact restoration source. Only rows marked by that job/root transition, with matching current lifecycle and Trash identity, return to their original state. Independently archived/trashed items have no mark and remain untouched. New metadata edits can be retained if lifecycle/provenance still match. No generic recursive `status='active'` writer is trusted.
- Committing one root is atomic via Serializable state + marker create/retire + checkpoint + activity. Cancellation and failures after root commit cannot undo earlier roots.
- Concurrent or layered operations on an active marker are rejected; callers cannot accidentally stack a second transition with ambiguous restore history.

## Defense in depth

- Existing single-item restore, deletion, interactive bulk, direct folder lifecycle PATCH and background archive/unarchive are guarded against bypassing active provenance. Direct folder lifecycle writes now refuse status transitions that would have changed a root without descendants.
- Destruction endpoint checks outstanding provenance and requires the separate destruction eligibility path; no physical unlink in R62.
- Jobs carry actor identity; they are Library-owned for disabled-tool deferral and revalidate ACLs during every root commit. Owner-scoped progress and cancellation cannot reveal other users' jobs.
- No reliance on client-provided digest for mutation authority; worker checks full tree again.

## Tests

- 17 executable simulated-transaction checks cover independent Trash/Archive preservation, precise restore, nested permission/Personnel Record/lock denials, holds/retention, offboarding, changed snapshot, harmless metadata edits, failure-atomicity of provenance, replay after lost acknowledgment, stacking, managed folders, overlapping roots and cancellation.
- 9 route/UI/migration/source contract checks cover preview/submit/replay, authenticated job status, atomic evidence, migration constraints, old endpoint barriers, runtime registration, renderer confirmation and visibility-aware status.
- Inherited TD4 test selection, including R61 move and TD2 ownership, passed under the explicitly documented Node 22 development setup.

## Inherited defect discovered during packaging

The existing R61 `hierarchyMoveSchema` called `.extend()` after `.superRefine()`. In the pinned Zod 3.24.1 runtime, `superRefine` returns `ZodEffects`, which cannot be extended and can fail on module evaluation. R62 builds preview and submit contracts independently from one base object and applies the same duplicate-root refinement to each. The new R62 lifecycle contract uses the same compatible pattern. Focused source assertions guard both.

## Runtime exclusions and action items

No database migration deployed; no external real PostgreSQL transaction test, Node 24 dependency-backed `tsc`, real browser/multi-user UI run, Windows/Qt acceptance or file storage disposition. Large-root transaction throughput/locking must be measured. Optional provider ownership/backfill and final action-adapter matrix remain open. R63 must implement the actual retention-governed physical file-disposal lifecycle before TD4 closure.
