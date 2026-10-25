# TD5 P11 | Durable job telemetry fault-isolation audit

**Baseline:** Cluster v0.546.0 TD5 P10. **Status:** Source implemented and fault-injection tested; no live PostgreSQL certification.

## Reproduced source-level failure modes

1. `DurableJobWorker.execute()` awaited the queue `succeed()` commit, then directly invoked the injected `logger.info()` inside the handler's outer `try`. When the logger threw after durable success, control entered the handler's error path and tried to write a contradictory `queue.fail()` acknowledgement. PostgreSQL fencing would normally reject it, but the worker could falsely increment lease-loss statistics and misreport a successfully completed job.
2. Warning telemetry in detached heartbeat and cancellation-poll `.catch()` callbacks was not protected against a throwing logger; a throw from the logger could create a process-level unhandled rejection. Similar exposure existed in early disabled-job deferral, shutdown release, and failure acknowledgement paths.
3. The queue service protected some post-commit telemetry only from *synchronous* exceptions. A logger returning a rejected Promise could still escape via enqueue, the wake-publisher `.catch()` handler, or a committed failure acknowledgement.

## Corrections

- `apps/server/src/domains/jobs/job-worker.ts`: central `log` method handles thrown and Promise-rejected logger outcomes; applies consistently to startup/stop deferrals, detached timer failures, uncertain commit warnings and completed jobs.
- `apps/server/src/domains/jobs/job-queue-service.ts`: same guarded log contract for successful enqueues, failed wake publication and committed failure acknowledgements.
- Explicitly preserve queue state and counters after successful ACKs, regardless of a broken telemetry sink. No extra write, external dependency, migration or fallback codepath.

## Evidence and limitations

- **12/12 P11 executable tests passed** using real production TypeScript transpilation and deterministic queue/database fixtures. Includes sync and async logger failures, committed success/failure boundaries, detached timers and outgoing wake publication.
- **73/73 selected inherited+current regression scripts passed**, including 71 inherited from P10 plus the P10 and P11 focused suites. Two historical source tests required a temporary global TypeScript symlink that was removed before packaging.
- Active source scanner: 1,042 TypeScript/TSX files, 110 CSS files, 4,502 authored relative imports; zero parse/CSS errors or missing authored imports. Generated Prisma import intentionally absent.
- Incomplete `tsc` on P10 and P11: 2,909 dependency-related errors each; **zero new normalized diagnostic signatures**. This is not a successful TypeScript application build.
- **NOT_PERFORMED:** Node 24.20.0 + reviewed `package-lock.json` + `npm ci`, live PG18 migrations/multi-process testing, Windows/Qt and NTFS/SMB/NAS/S3 acceptance. The container still has Node 22 and no PostgreSQL runtime.
- Unfenced physical deletion, auto GC, quarantine execution and tier migration remain disabled.

These tests validate JavaScript/TypeScript job lifecycle transitions against controlled substitutes. They do not demonstrate durable Postgres transaction isolation, crash consistency, or production recovery.
