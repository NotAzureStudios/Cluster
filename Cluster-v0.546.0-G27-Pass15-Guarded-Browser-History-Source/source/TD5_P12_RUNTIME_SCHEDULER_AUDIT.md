# TD5 P12 technical audit: scheduler lifecycle and diagnostics

## Root cause and risk

P11 isolated logger failures inside `DurableJobWorker` and `BackgroundJobQueue` but the wrapping `createServerJobRuntime()` still called `input.logger.warn` directly in three critical error paths: claim-loop failure, fresh tool availability lookup failure, and context/tool dependency lookup failure. A logger that throws could interrupt retry setup, and a logger that returns a rejected Promise could raise an unhandled rejection from a detached scheduler invocation. A boot path calling `start()` twice could also schedule recurring producers twice. After `drain()`, the worker's stop state and unsubscribed wake listener were not restartable even though `start()` appeared to allow it.

## Fix

- Central guarded `log()` handles synchronous exceptions and observes rejected thenables, without changing DB/authorization state.
- Logger failures in authoritative policy reads still return **false**, preserving fail-closed admission on uncertain settings.
- The claim-loop catch still applies bounded backoff and schedules a subsequent attempt even with an unusable logger.
- Calling `start()` twice while active does nothing; calling it after drain throws a clear error that a new runtime instance is required.
- No PostgreSQL schema/transaction modification, no unsafe storage deletion, and no invented cross-process claims.

## Executable coverage

`node --test tools/scripts/cluster-td5-p12-runtime-scheduler-isolation-tests.mjs`

Seven fault-injection cases: sync logging throw + settings outage, async logging rejection + settings outage, duplicate start, drained restart, claim error + sync logger throw, claim error + async logger rejection, and snapshot error + logger throw. Worker scheduling is accelerated only in the test by a temporary local time wrapper and restored afterward. Assertions exercise the actual compiled production runtime module with stubbed database/worker dependencies.

## Limitations

Environment lacks pinned Node 24 and the reviewed project lockfile/installed workspace dependencies and has no real PostgreSQL 18 instance. A TypeScript diagnostic diff with P11 and deterministic source tests do **not** constitute full compilation or crash/recovery certification. Windows Qt/Win32, NTFS, SMB/NAS and S3 remain unverified.
