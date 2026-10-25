# TD5 P7 | PostgreSQL runtime and acceptance audit

## Confirmed defects

**False-positive server-version certification:** `configurePostgresqlRuntime()` requires PostgreSQL 18+, while the P6 acceptance gate allowed 17/18. That meant the gate could report a passing environment on which the server intentionally refused to start. P7 checks the exact configured PostgreSQL 18 major for a full-workspace acceptance run.

**Connection budget over-allocation:** `databaseResourceBudget()` previously used an explicit `connection_limit` unconditionally. With 32 budgeted connections, four API nodes, four reserved slots and four coordination sessions, `connection_limit=500` could allocate 2,000 API connections. The corrected per-node maximum is 6, fitting exactly inside 32 total slots. Configurations with insufficient slots for one API connection plus coordination per node now fail at server initialization.

**Acceptance-runner overlap/unbounded stages:** P6 disconnected immediately after empty-db validation, leaving no mutex across spawned migrations, and subprocesses had no time limits. P7 holds a session-scoped advisory lock and rejects other open DB sessions at admission. All stages use a bounded process runner with executable-array arguments, explicit deadlines, proper nonzero status handling and process-tree termination. This reduces overlap risk but does NOT prevent a separate, non-cooperating process from mutating the disposable DB later; a physically isolated test database remains mandatory.

**Historical test contract:** TD2's upload-retention test expected remote deletion despite P5 changing it to deferred journal evidence. It now tests the current non-destructive path and lossless handling of failed journal recording.

## Security and operating limits

- The database name prefix and consent token are additional guardrails, **not proof** a host is nonproduction. Do not point the runner at live data.
- The advisory mutex prevents concurrently running TD5 gates on the same database, not arbitrary third-party writers. Other sessions at initial admission are rejected; concurrent connections intentionally opened by the gate's own child tests are allowed afterward.
- The gate preserves a database session across the full test sequence. Unexpected parent-process death releases the session lock. PostgreSQL migration/application tests are still unexecuted here.
- Stage process-tree timeout coverage was executed on Linux; `taskkill /T /F` remains Windows source-only until live acceptance.
- The acceptance gate currently prints step output to its invoking terminal; command diagnostics could include sensitive content, so treat local test logs as secrets. The gate's own summary does not print connection URLs.
- Server pool budget is a configured estimate. PostgreSQL `max_connections`, system tasks, PgBouncer, and external database users require live capacity verification.

## Executed validation

- 10/10 new server/budget unit tests.
- 8/8 new bounded-process and safe-refusal tests.
- 8/8 inherited P6 tests.
- 54/54 selected inherited TD2/TD4/TD5 regression scripts.
- Active-source scan clean; no new incomplete-environment TS error signatures versus P6.
- No Node 24, live PostgreSQL, Windows or provider-generation tests performed.
