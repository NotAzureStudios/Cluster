# TD2 Pass 20 — Durable queue uncertainty, attempt reconciliation and multi-process protocol testing

**Baseline:** TD2 Pass 19 / Cluster v0.546.0. **Checkpoint:** TD2 Pass 20. 2026-10-12.

## Confirmed source defects fixed

1. **Unobserved fire-and-forget handler rejections.** `DurableJobWorker.claimBatch()` registered `execute(job).finally(...)` without a rejection observer. Failure to acknowledge a job (e.g. a database write rejecting during `fail()`, invalid-payload handling, or unknown-handler handling) could become an unhandled rejection after the caller returned. The worker now observes/logs such failures before handing control back to the polling loop, increments `unacknowledgedErrors`, and leaves the claim for fenced lease recovery rather than falsely claiming that a DB transition succeeded. Diagnostics logging exceptions are isolated.
2. **Ambiguous success acknowledgements misclassified as handler failures.** A rejected `queue.succeed(...)` call was caught by the broad handler catch and followed by `queue.fail(...)`. If the successful commit completed but the reply was lost, that could turn a completed job into a failure report or issue conflicting writes. Success acknowledgement uncertainty is now tracked separately; no contradictory FAIL is issued. Lease expiration handles uncommitted claims; side effects must still be idempotent because ambiguous completion cannot be atomically determined from a broken connection.
3. **Stale attempt audit history after lease recovery.** Claiming an expired `RUNNING` job left its prior `BackgroundJobAttempt` row `RUNNING` indefinitely. The queue now closes older RUNNING attempts as FAILED within the reclaim transaction, prior to inserting the new attempt. The exhausted-retry DEAD_LETTER transition also finalizes any lingering RUNNING attempt in the same SQL statement. Historical `error` and `finishedAt` are recorded; already terminal attempts are not rewritten.
4. **Excessive overlapping lease/cancellation SQL.** Periodic heartbeats, periodic cancellation checks, and on-demand handler safe-point checks could issue simultaneous duplicate queries for a single claim under DB latency. Renewals and cancellation reads now coalesce per claimed job. Errors remain observable and the existing uncertainty lease budget continues to fail closed on prolonged outage.
5. **Misleading error counters.** Unknown-handler / malformed-payload failures previously incremented `failed` even when the DB returned `false` due to a lost lease. They now count lease loss accurately; only acknowledged failures increment `failed`.

## Actual scope and verification

- New `cluster-td2-worker-fault-isolation-tests.mjs`: **6** exercised cases including callback-level heartbeat and cancellation single-flight behavior and ambiguous success/failure acknowledgements.
- New `cluster-td2-multiprocess-worker-fault-tests.mjs`: **2 independently forked Node processes** run the real TS-transpiled `DurableJobWorker` code, sharing a parent-owned deterministic lease/queue IPC authority. Five distinct scenarios: concurrent execution without exceeding per-process limit; Library disable/deferral and independent shared work; success and failure DB acknowledgement outages; stale lease reclaims and malformed/unknown jobs; orderly two-process drain. Successfully rerun **six additional times**.
- New `cluster-td2-attempt-recovery-tests.mjs`: **4** executable SQL-boundary checks for transactional attempt cleanup, exhausted-leases and disabled-type claim filtering.
- New `cluster-td2-postgres-queue-certification.mjs`: **opt-in real PostgreSQL 17/18 harness**. Uses two independent `pg.Client` connections, the production `BackgroundJobQueue` SQL, randomized disposable schema with job/attempt fixture tables, and asserts competing claims, fencing, stale-attempt reconciliation, deferred retry budget and exhausted retry cleanup. Explicit consent/environment gating prevents accidental operation. **Not executed here:** no PostgreSQL runtime/driver. This is not a full Prisma migration/Windows/Qt certification harness.
- Executed **37/37 inherited and new validation commands** using Node v22.16.0; complete machine-readable log in `TD2_PASS20_REGRESSION_RESULTS.json`. Static TypeScript audit passed (see log); test harness does not prove a Node 24 full build.
- No changes to Prisma schema, migration files, native executable or UI layout. No intentional protocol compatibility shims. Existing tool switches and ownership checks remain intact.

## Certification boundaries and next actions

**NOT certified:** actual PostgreSQL 17/18 contention, Node v24.20+, complete workspace dependency installation/TypeScript/Prisma build, Windows-native host and child-process shutdown, real running Cluster disabled-vs-enabled CPU/network/database measurements, or exactly-once side effects. The IPC harness is *multi-process protocol simulation*, not a substitute for PostgreSQL transactional verification.

On a disposable PostgreSQL 17 or 18 database after installing dependencies:

```bash
TD2_CERT_DISPOSABLE=I_UNDERSTAND TD2_CERT_DATABASE_URL=postgresql://USER:PASS@HOST:PORT/THROWAWAY_DB node tools/scripts/cluster-td2-postgres-queue-certification.mjs
TD1_CERT_DISPOSABLE=I_UNDERSTAND TD1_CERT_DATABASE_URL=postgresql://USER:PASS@HOST:PORT/THROWAWAY_DB node tools/scripts/cluster-td1-postgres-certification.mjs
```

The TD2 harness creates/drops only a randomly named schema, but still requires a **throwaway database**, never a production Cluster connection. Run the full server and media-worker process tests separately on Windows/Node24, comparing actual SQL rate, CPU, memory and network counters with the same workload before/after disabling Calendar, Library and Tickets. If the real-PostgreSQL SQL harness reveals syntax or behavior defects, fix them before TD2 closeout. **TD1 and TD2 remain open for certification; TD3 should not be mistaken as already started.**
