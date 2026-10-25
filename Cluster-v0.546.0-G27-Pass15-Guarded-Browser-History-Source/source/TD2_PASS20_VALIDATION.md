# TD2 Pass 20 validation — honest certification record

- Date: 2026-10-12
- Source: Cluster v0.546.0 TD2 Pass 20 (parent Pass 19)
- Node runtime in container: v22.16.0, **not** the required Node 24.20+.
- Inherited and newly added regression/static/registry commands: **37/37 passed**. Detailed logs: `TD2_PASS20_REGRESSION_RESULTS.json`.
- Standalone new suites: **6/6 worker-fault**, **5/5 cross-process IPC scenarios**, **4/4 queue-recovery SQL-boundary**.
- Two independent Node worker processes exercised actual `DurableJobWorker` logic, with IPC-based transactional queue authority (NOT PostgreSQL). The multi-process suite additionally passed six consecutive repeat executions.
- Failed finalization and failure-acknowledgement injection: recovered by retry/lease expiry in simulation without unhandled child exits. All seven mock jobs reached terminal states; deferrals preserved retries.
- `node --check` for the optional PG certification harness: passed. Negative consent gate correctly exits 2 without performing database writes.
- Source syntax and tool-registry checks: passed under inherited validation matrix. Native Windows/Qt binary unchanged.
- PostgreSQL 17/18 live transactions/SQL: **NOT executed**; runtime and `pg` dependency unavailable.
- Node24 complete build, Prisma generate/validation, Windows host, CPU/SQL/network production idle measurements: **NOT executed**.
- No production certification claim and no exactly-once guarantee for external side effects.

## Package verification

Source hash manifest, ZIP integrity and independent patch replay must be checked before handoff. `SOURCE_FILE_MANIFEST.sha256` covers all source files excluding itself.
