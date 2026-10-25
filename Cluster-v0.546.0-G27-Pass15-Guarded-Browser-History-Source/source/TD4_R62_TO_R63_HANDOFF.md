# Cluster TD4 R62 → R63 continuation

## Current authoritative development source

`Cluster-v0.546.0-TD4-R62-Durable-Library-Hierarchy-Lifecycle-Source.zip`, folder `source/`. Product version remains `0.546.0`. TD4 source implementation remains **active**. Do not base new changes on R61 or older.

## What was implemented / must be preserved

- Zod 3.24.1 contract fix: R61 move submit schema and R62 lifecycle submit schema now extend base schemas before `superRefine`; retain duplicate-root rejection for both paths.
- `apps/server/src/domains/library/library-hierarchy-lifecycle.ts`: bounded preview, fingerprint, revalidation, durable per-root archive/trash/restore. Use existing `library-bulk-transaction-guard.ts`, `LibraryBulkCheckpoint`, and TD2 worker owner. No generic scheduler fork.
- `LibraryHierarchyLifecycleEntry` Prisma schema and new migration: stable audit of exactly which item was touched by which originating lifecycle job, original status/deletion identity, applied Trash identity, and restoration time. Without an active mark, an independently trashed child is not restored by its parent.
- `library-routes.ts`: five lifecycle routes (preview, submit, get, cancel and selection helper) plus defensive refusal of old root-only folder lifecycle paths; guards on single-item restore/destruction/delete, metadata PATCH lifecycle modifications, and interactive bulk.
- `library-bulk-jobs.ts`: background archive/unarchive refuses active-mark entries.
- `LibraryWorkspacePage.tsx`: reviewed hierarchy action, session-persisted handle, owner-scoped polling, cancellation and partial-commit messaging. R61 hierarchy move remains independent and working.
- `job-tool-ownership.ts`, app composition and TD2 ownership tests include `library.hierarchy.lifecycle`.
- `tools/scripts/cluster-td4-r62-hierarchy-lifecycle-tests.mjs` executes actual TS with simulated transactional rollback. `cluster-td4-r62-hierarchy-ui-integration-tests.mjs` covers routes/worker/schema/UI contracts. `TD4_R62_REGRESSION_RESULTS.json` and source scan capture evidence.

## Explicit source limits

- Up to 24 independent roots and 5,000 records per request. Each root atomic in DB; across roots partial completion is intentional.
- Restore requires active operation provenance for the selected root. It cannot automatically resolve outside lifecycle changes that invalidate its original status/deletion identity. It intentionally rejects ambiguous recoveries.
- One active hierarchy lifecycle operation at a time per affected entry. Restore before stacking Archive/Trash on those records.
- 5,000-record per-root transactions need measured PostgreSQL duration and crash/retry tests; simulated Prisma test is not sufficient acceptance.
- The new migration is source-authored; it has not been deployed to live Postgres.
- Never claim physical disposal is implemented; `library-destruction.ts` currently deletes database authority without unlinking bytes, and orphan auditing is evidence only.

## R63 priority

**Governed file disposition as an end-to-end workflow**, without introducing unsafe immediate unlink. Start with retention/hold reasons and immutable evidence, restore-window semantics, version/derivative/publication reference sweep, isolated quarantine or storage disposition ledger, and idempotent authorized worker with ownership checks. Only retire physical bytes after the full protocol is implemented and live acceptance completed. In parallel, audit remaining direct lifecycle writers and multi-user authorization/availability edge cases.

## Certification gates outstanding

Node 24 dependency-backed build, generated Prisma, PostgreSQL 17+/18 migration and multi-process concurrency, browser authenticated two-user permissions, actual Library file roots/NAS, Qt/Windows DPI and native process lifecycle, and recovery after deliberate process termination.
