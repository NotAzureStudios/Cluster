# Cluster v0.546.0 — TD2 Pass 22: bounded recovery and integrated certification gate

**Parent:** TD2 Pass 21 distributed workspace admission.
**Change level:** source-only, no new PostgreSQL migration, native EXE unchanged.
**Status:** source-implemented; PostgreSQL 17/18, Node 24, Windows service and production resource certification NOT COMPLETE.

## 1. Production queue change

`apps/server/src/domains/jobs/job-queue-service.ts::claim()` previously reconciled every expired, retry-exhausted row globally using an unbounded data-modifying CTE. That query runs on every claim transaction, even for unrelated queues. A large crash/restart backlog could therefore create an unbounded write/row-lock burst, along with contention between unrelated worker transactions.

The transaction now first selects **up to 64 oldest eligible stale rows** using `ORDER BY "updatedAt", "id" FOR UPDATE SKIP LOCKED LIMIT $1`, then updates the selected jobs to `DEAD_LETTER` and finalizes their still-`RUNNING` attempts within the same SQL statement and transaction. Other claimers can skip locked rows rather than waiting for a competing recovery sweep. The remaining stale jobs are processed in subsequent claim calls. The normal job admission/lease/token logic and transaction rollback remain unchanged.

**Limitations:** This limits *rows mutated per claim*, not total SQL planner cost: PostgreSQL still evaluates candidate conditions. A backlog without any claim polling will remain until polling resumes. This is not a replacement for scheduled cleanup, nor evidence of improved production p95 latency. The recovery cap makes cleanup incremental; a total backlog of N exhausted jobs requires at least ceil(N/64) claim cycles. A queue with continuously arriving higher-priority work may still need operational monitoring for terminal-history cleanup progress. Real database throughput and index plans remain to be measured.

## 2. New tests

`tools/scripts/cluster-td2-bounded-recovery-tests.mjs` runs the **production BackgroundJobQueue implementation** with transaction/row-lock simulation. Six scenarios verify: 64-row cap, full 300-job incremental recovery, two simultaneous claimers recovering distinct rows, rollback on database errors, independent queue filtering, and no rewrites after the backlog is empty. The inherited attempt-recovery and workspace contention tests were updated to assert the new SQL contract.

The opt-in **real SQL certification harness** `cluster-td2-postgres-queue-certification.mjs` now inserts 150 expired jobs (135 `RUNNING` with attempt history, 15 `QUEUED`), calls the real queue against two PostgreSQL sessions and asserts 64 → 128 → 150 terminal rows and all 135 attempt records finalized. This live test is prepared but **has not been run** in this container.

## 3. Consolidated certification launcher

`tools/scripts/cluster-td1-td2-certification-gate.mjs` adds:

- `npm run certification:td1td2:preflight` — JSON prerequisite report, checks Node 24, `typescript`, `pg`, `prisma`, both disposable database URLs and *explicit* consent. On missing prerequisites exits 2 and runs no SQL.
- `npm run certification:td1td2:run` — if and only if preflight succeeds, runs the existing TD1 isolated-schema PostgreSQL CAS harness, TD2 production queue SQL harness, Prisma schema validation and complete dependency-backed application build, in order. Each step records exit status, duration and bounded redacted output in `TD1_TD2_LOCAL_CERT_REPORT.json` (override `TD1_TD2_CERT_REPORT_PATH`). Stops on first failure.
- `tools/scripts/cluster-td1-td2-certification-gate-tests.mjs` exercises five no-DB cases, including missing consent and report credential hygiene.

**Safety:** Both database harnesses require explicit disposable-database consent and create/drop random isolated schemas. Do not point them at production: isolation is a second layer of protection, not permission to run risky validation on production.

The launcher never claims Windows process supervision, actual full-server enabled/disabled resource savings, Qt testing, or server-soak certification. Even a fully green launcher would still leave those separate release gates open.

PowerShell example on a disposable PostgreSQL 17/18 instance with Node 24 and installed workspace dependencies:

```powershell
npm run certification:td1td2:preflight  # expected blocked until variables are set
$env:TD1_CERT_DISPOSABLE = 'I_UNDERSTAND'
$env:TD2_CERT_DISPOSABLE = 'I_UNDERSTAND'
$env:TD1_CERT_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:5432/DISPOSABLE_DB'
$env:TD2_CERT_DATABASE_URL = $env:TD1_CERT_DATABASE_URL
npm run certification:td1td2:preflight
npm run certification:td1td2:run
```

## 4. Validation evidence and remaining gates

- **40/40** TD0–TD2 and tool-registry validation commands pass under **Node 22.16.0**.
- **6/6** new recovery simulator scenarios and **5/5** combined-gate safety checks pass.
- Source parser audit: **994 TS/TSX files, 0 syntax diagnostics**. Generated Prisma client is omitted from the lean source archive.
- PostgreSQL 17/18 live SQL: **NOT RUN**; no server/`pg` package available.
- Node 24 dependency-backed compilation, Windows process lifecycle and full-server CPU/SQL/network measurements: **NOT RUN**.
- See `TD2_PASS22_VALIDATION.md`, `TD2_PASS22_REGRESSION_RESULTS.json` and `TECH_DEBT_MASTER_ROADMAP.md` for exact evidence and closeout state.
