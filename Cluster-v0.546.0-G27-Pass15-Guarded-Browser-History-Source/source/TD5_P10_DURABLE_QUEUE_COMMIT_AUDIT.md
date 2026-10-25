# Cluster TD5 P10 | Durable queue commit-boundary audit

**Baseline:** v0.546.0 TD5 P9. **Status:** source implemented and executed against a deterministic transactional fault-injection double; NOT live PostgreSQL 18 certified.

## Verified source defects

1. `BackgroundJobQueue.enqueue()` previously invalidated its in-memory counts and called the injected `logger.info` *inside* a Prisma interactive transaction. Throwing loggers could abort the database insert, and other code reading counts during an in-flight transaction could cache an old snapshot after the premature invalidation.
2. `BackgroundJobQueue.claim()` invalidated counts inside its transaction. A rollback could discard the claim while the cache had already been invalidated, and a concurrent stale count read could then cache the pre-commit state. A claim sweep can also mark exhausted/cancelled jobs terminal **without returning a claim**, so invalidation must not be conditioned only on a non-null claim result.
3. `BackgroundJobQueue.fail()` called `logger.warn` *after* successful transaction completion without guarding exceptions. Logging failure could make the worker treat an already committed failure acknowledgement as unacknowledged.
4. `counts()` could publish an old PostgreSQL snapshot back into the cache even after a different operation had committed and invalidated the cache. The two-second TTL made this visible to live status readers.
5. The shared runtime acceptance helper still identified itself as `TD5 P8` despite the continuing P9/P10 deployment workflow. Labels are now stable across implementation passes.

## Implemented

- Return `{job, inserted}` from the enqueue transaction; after commit, invalidate and log only genuinely inserted jobs. Throwing telemetry is contained. Existing dedupe entries remain idempotent and are not reported as new inserts.
- Invalidate claim counts only after the entire claim/reconciliation transaction resolves successfully; invalidate even if no claim was returned, because cleanup can mutate job statuses.
- Catch failed post-commit `warn` emission; preserve committed acknowledgement semantics.
- Add `countsGeneration`; an asynchronous count read may return its legitimately old snapshot to its own caller but cannot overwrite a more recent cache generation.
- Replace the stale P8 label in the long-lived acceptance gate with `TD5 Runtime Acceptance`; actual Node 24/PG 18 eligibility is unchanged.

## Executed checks

- 11 focused P10 executable checks: commit/rollback, throwing loggers, post-commit publication order, deduplication, stale asynchronous cache read, claim-sweep invalidation, aborted claims, acknowledged failures, wake publication, stable gate label.
- 71 inherited selected TD4/TD5 scripts (requires a **temporary test-only** link to already-installed global TypeScript for two lean source tests; link removed before packaging).
- Global TypeScript source parse / CSS / relative-import scan; compare incomplete server tsc diagnostics against untouched P9 (do not treat as dependency-backed compilation).
- P9 → P10 exact source reconstruction and archive SHA256 verification are documented in the integrity report.

## Scope boundaries

These tests execute the production queue TypeScript using a deterministic SQL/transaction double. They verify JavaScript control flow and commit-boundary ordering, **not** PostgreSQL's transaction isolation, locks, parallel claims, Prisma's generated runtime, migration correctness, or actual crash recovery. The real acceptance command remains `node tools/scripts/cluster-td5-p6-runtime-gate.mjs --run --json` on an explicitly authorized empty `cluster_td5_cert_*` PostgreSQL 18 database after the pinned Node 24 and reviewed workspace lockfile have been installed with `npm ci`.

**Still disabled:** unfenced physical object deletion, automatic managed-blob GC, tier migration, quarantine execution. Native Windows, Qt, NTFS/SMB and remote provider recovery tests remain separate.
