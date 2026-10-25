# TD2 Pass 19: Runtime recovery, lifecycle evidence and measurement

**Parent:** Cluster v0.546.0 TD2 Pass 18. **Classification:** source implementation and isolated runtime tests, not release certification.

## Why this connected pass matters

The global resource governor is a core shared service. Its previous timer called `await sample(); schedule()` without catching failures: an exception from telemetry or pressure accounting could silently terminate periodic governance. A stop while a query was pending could also apply capacity changes after shutdown. Fixing the job queue alone would not protect this admission-control loop.

## Production changes

- `server-resource-governor-runtime.ts`: resilient sampling tick with logging and a guaranteed retry while running; generation invalidation on stop/restart; no stale capacity update after shutdown; accurate last-success/error/next-run diagnostics; queue snapshot fallback does not masquerade as a successful DB sample.
- `background-tasks.ts`: tool-owner summary of timers, listeners, activity and execution counts. Cooperative aborted runs are counted separately. Actual errors after an abort still count as failures.
- `cluster-server.ts` / `server-routes-health-operations.ts`: inject governor warning logger, expose diagnostic summaries only through admin Operations routes; keep the public `/health` free of sampler error details.
- `package.json`, `tools/scripts/cluster-td2-runtime-closeout-tests.mjs`, `tools/scripts/cluster-td2-idle-activity-benchmark.mjs`: stable validation entry points for closeout and isolated wall-clock tool toggle evidence.

## Owner lifecycle and data safety

Suspending a tool stops its owned timer and removes its owned listener; it must NOT suspend shared storage retention, backup, onboarding, database health, resource governance or core services. Already-committed writes cannot be undone. The cancellation count represents an aborted callback, not proof of an aborted database transaction.

## Explicit evidence limits

The synthetic 15 ms timer benchmark measures callback counts over three 240 ms windows, not actual server resource consumption. PostgreSQL, Node 24, Windows native host process trees, external webhook delivery and complete application typechecks remain unverified. Do not call TD2 certified.

## Next practical certification gates

1. Install full dependencies from a reproducible lockfile with Node 24 and generate Prisma artifacts; compile all server/shared/renderer code.
2. Start disposable PostgreSQL 17/18, run all migrations and a two-process worker contention suite (lease expiry, shutdown race, tool disable/re-enable, queue deferral).
3. Run Windows managed-host server/client with process-tree checks; measure idle requests/queries/event-loop and tool-owned callbacks over repeatable enabled/disabled windows.
4. Fix only observed failures, rerun the entire validation set and archive logs and baselines before declaring TD1/TD2 closed.
