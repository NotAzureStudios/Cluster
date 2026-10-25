# TD2 Pass 23 — Orphaned cancellation recovery and committed-enqueue wake safety

**Parent:** TD2 Pass 22. **Release:** v0.546.0. **Date:** 2026-10-12.
**Status:** Source implemented and tested; Node 24, PostgreSQL 17/18, Windows and full-server performance certification remain OPEN.

## Confirmed correctness issues

1. A RUNNING job with `cancelRequestedAt` and remaining retries was ineligible for `claim()` (correct), but the expired-lease cleanup only reconciled jobs with `attempts >= maxAttempts` (incorrect). If a worker crashed after a cancellation request, the job and its attempt could remain in RUNNING indefinitely. Worse, exhausted cancelled jobs were recorded as DEAD_LETTER instead of CANCELLED.
2. `enqueue()` successfully committed a new job, then invoked an optional cross-process wake publisher outside its failure handling. A synchronous publisher exception could escape to the API caller despite the committed job, enticing the client to retry an already-created job. Asynchronous rejection was partly covered, but a throwing logger could turn it into an unobserved error.

## Implementation

- Extend the existing single, transactional, 64-row `FOR UPDATE SKIP LOCKED` cleanup to include both **expired RUNNING cancellations** and **queued cancellation records**, even if `runAfter` is in the future. Preserve the existing terminal path for expired retry-exhausted jobs.
- Prefer CANCELLED over DEAD_LETTER when both cancellation and exhaustion apply; update matching running attempts to CANCELLED or FAILED atomically, preserving their timestamps and existing cancellation error values. A still-valid running lease is not terminated by reconciliation: the current worker retains a chance to observe cancellation and acknowledge safely.
- Keep the same row-lock order, per-transaction cap and workspace admission. Reclaimed running jobs without cancellation and with retries left remain reclaimable, not terminal.
- Treat optional wake publisher invocation as a best-effort *post-commit notification*, covering sync throws, rejected promises and error-logging failures. The enqueue return value remains the committed job record.
- Add reproducible controlled transaction tests for 150 mixed cancelled/exhausted jobs, concurrent cleanup, deferred cancellations, still-valid leases, rollback and best-effort wake failures. Expand the opt-in real PostgreSQL harness with multi-batch orphan recovery, attempt-state assertions, and normal reclaim following cancellation cleanup.
- Update existing SQL-boundary contract tests to require cancellation precedence instead of assuming every expired job is a failed attempt.

## Validated here

- **40/40** inherited regression/static/tool-registry commands passed under **Node 22.16.0**.
- **16/16** bounded recovery and cancellation/failure scenarios passed (including ten new coverage scenarios).
- **15/15** repeated mixed-recovery suites and **10/10** repeated two-OS-process worker fault tests passed.
- PostgreSQL certification test syntax checked, but live SQL was NOT executed.
- Consolidated TD1/TD2 preflight returned **BLOCKED** as expected (Node 22; no installed `pg`/Prisma; no authorized disposable DB).
- TypeScript static parser audit: zero syntax errors across 994 files; one generated Prisma import expected missing in lean source.

## Certification and design limits

- Cleanup only runs during worker claim cycles; a deployment without an active claim poller will not reconcile orphan cancellations until a claim cycle resumes.
- Cancellation cannot roll back external effects already performed by the old worker. A still-unexpired worker may finish; the queue's existing fence and cancellation acknowledgement must remain authoritative.
- No live Postgres transaction/lock proof, Node 24 dependency-backed build, Windows host process test or full-server performance figures from this environment.
- Cross-process wakes remain advisory. Actual PostgreSQL state, not an event-bus wake, controls claims and recovery.

## Follow-up

Execute `npm run certification:td1td2:run` with the explicit disposable Postgres 17/18 setup and Node 24 prerequisites. Test lost worker on cancel, leased worker acknowledgment, restart/replay, and post-disable resource measurements on a Windows machine. Correct defects uncovered by live runs before marking TD1/TD2 certified. Do not advance TD3 on source-only evidence.
