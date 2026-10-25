# TD2 Pass 21 — Transactional workspace claim admission

**Parent:** TD2 Pass 20, Cluster v0.546.0. **Status:** source changes implemented and verified in deterministic contention simulation; **real PostgreSQL is not certified**.

## Confirmed concurrency defect

`BackgroundJobQueue.claim()` previously ran a single candidate-selection `UPDATE ... FROM` with `FOR UPDATE SKIP LOCKED` and a `workspace_load` aggregate. This fences **one job row** but not the workspace-wide concurrency and cost budget. Under PostgreSQL READ COMMITTED, two independent transactions can select **different ready jobs from the same workspace** using the same snapshot, then both update their own row: the aggregate condition is not a serialized workspace admission gate.

## Implementation

- Select exactly one eligible job using the existing queue/type/due/priority and capacity predicates plus `FOR UPDATE OF job SKIP LOCKED` to prevent contention on that candidate row.
- Acquire one transaction-scoped workspace advisory lock (`cluster-job-workspace-running:<workspaceId>`) using the already-existing advisory helper. Workers consuming different queues share that lock. Jobs with no workspace do not acquire one.
- After the lock is granted, execute the **actual conditional claim UPDATE in a separate SQL statement**, rechecking workspace `RUNNING` count and running cost in a fresh READ COMMITTED snapshot, and restricting the UPDATE to the preselected job's ID. Then reconcile attempts and insert the new attempt **inside the same transaction**.
- Lock at most one workspace per claim transaction to avoid cross-workspace advisory-lock ordering cycles. If the candidate is no longer admissible, return `null` and retry on the next ordinary worker poll, rather than consuming an attempt.
- Preserve claim-token fencing, retry/deferral accounting, excluded tool-owned types, lease recovery, and priority scheduling.

## Evidence

- `tools/scripts/cluster-td2-workspace-claim-races.mjs` adds **eight executable cases** with the production TS-transpiled `BackgroundJobQueue` and a deterministic READ COMMITTED/row/advisory-lock simulator: same-workspace concurrency, same-workspace cost, cross-queue contention, independent workspaces, null-workspace jobs, and excluded tool types. Repeated the entire eight-scenario suite 12 additional times successfully.
- Existing lease claim, retry-history, owner lifecycle, two-process fault-injection, Settings and static tests all pass. `TD2_PASS21_REGRESSION_RESULTS.json` gives the full command-by-command record.
- Extended `cluster-td2-postgres-queue-certification.mjs` with live PostgreSQL assertions for read-committed isolation, same-workspace count contention across separate queues, cost contention across separate queues, and independent-workspace admission. Also sets statement and advisory lock timeouts. The script requires explicit disposable-database consent and a PostgreSQL 17/18 server plus `pg`; **it was NOT run** here.

## Performance and deployment tradeoffs

This safety fix introduces **one additional candidate-selection SQL statement per claim**, and workspace claims acquire one PostgreSQL advisory lock. It may increase database work or claim latency under contention; throughput and query rates must be measured in production-like load. A no-claim path now performs the preselection instead of a single update. Failing admission due to a concurrent claimant returns no job and relies on the next worker poll.

The design assumes PostgreSQL's default **READ COMMITTED** transaction isolation. The opt-in PostgreSQL harness checks that setting. All worker processes must use this canonical claim path and compatible workspace concurrency/cost limits. Changing a workspace setting while already-running jobs exist does not retroactively stop them.

## Certification still required

1. Real PostgreSQL 17/18 transactions and SQL correctness, especially simultaneous claims across two connections and mixed queues.
2. Node 24, installed dependencies/Prisma generation and full TypeScript compile.
3. Windows native process shutdown, lease expiry/restarts and independent media-worker supervision.
4. Actual CPU, database query/latency and network savings for enabled/disabled tool owners, plus the extra SQL cost of admission.

**TD1 and TD2 remain open for runtime certification.** This is not a claim of exactly-once external effects, distributed readiness, or production performance.
