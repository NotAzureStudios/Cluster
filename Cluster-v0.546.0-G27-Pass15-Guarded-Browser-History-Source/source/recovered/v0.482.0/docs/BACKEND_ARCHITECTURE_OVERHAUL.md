# Backend Architecture Overhaul

Cluster v0.384.0 implements **Core Product & Architecture Roadmap Step 3 of 7: Backend Architecture Overhaul**. This condensed step combines the original server-domain-decomposition and background-job-infrastructure work into one backend boundary.

## Server domain ownership

The server now has an explicit domain catalog in `apps/server/src/app/server-domain-catalog.ts`. It records route roots, owning modules, and whether a domain is expected to perform asynchronous work. The catalog is exposed to administrators at `GET /api/admin/architecture/domains` together with domain-event metrics and durable-job posture.

The legacy `apps/server/src/routes` layer is now compatibility-only. Implementations are owned by explicit domains:

- Library and Packets: `domains/library`
- Scheduler and Time: `domains/time`
- Calendar and Timeline: `domains/planning`
- Offline synchronization: `domains/sync`
- User preferences: `domains/users`
- Legal, privacy, copyright, policy acceptance, disclosure, retention, and analytics routes: `domains/legal`
- Branding, meta diagnostics, and administrative tool operations: `domains/admin`

Every previous `routes/*` path remains as a tiny compatibility re-export barrel. This avoids a flag-day import migration while making the authoritative owner unambiguous and preventing the legacy route layer from regrowing implementations.

`cluster-server.ts` remains the application composition root. Durable-job construction and scheduling are isolated in `app/server-job-runtime.ts` so queue behavior, worker behavior, and recurring enqueue rules do not live inline in the entrypoint.

## Durable PostgreSQL job queue

Step 3 adds `BackgroundJob` and `BackgroundJobAttempt` PostgreSQL records. Jobs support:

- named queues and typed handlers;
- priority and delayed execution;
- bounded JSON payloads/results;
- configurable retry limits;
- exponential retry backoff;
- PostgreSQL `FOR UPDATE SKIP LOCKED` claiming;
- worker leases and heartbeats;
- expired-lease reclamation;
- dead-letter state after retry exhaustion;
- cancellation requests;
- progress percentage and operator-facing progress messages;
- attempt-level worker, duration, status, and error evidence;
- deduplication keys protected by transaction-scoped PostgreSQL advisory locks;
- bounded terminal-history pruning.

The durable queue intentionally does not accept arbitrary administrator-created job payloads over HTTP. Admin routes provide inspection, cancellation, and explicit retry only. New job producers are added in code so validation and authorization stay domain-owned.

## First migrated workloads

Existing recurring automation evaluations now enter the durable queue instead of executing directly inside timer callbacks:

- `automation.project-overdue`
- `automation.studio-due`

The in-memory `BackgroundTaskRegistry` still owns lightweight scheduler ticks and process-local maintenance. Its job is now to enqueue durable work or run genuinely ephemeral process maintenance, not to pretend an in-memory timer is a durable work queue.

A `system.job-history-prune` handler performs bounded cleanup of terminal job history.

## Administrative operations

Administrators can inspect:

- queue counts;
- active worker identity and concurrency;
- registered job types;
- queued/running/completed/dead-letter jobs;
- exact attempt history;
- progress and last failure;
- domain-event publication/failure/listener metrics;
- server domain ownership.

Routes:

- `GET /api/admin/operations/jobs`
- `GET /api/admin/operations/jobs/metrics`
- `GET /api/admin/operations/jobs/:jobId`
- `POST /api/admin/operations/jobs/:jobId/retry`
- `POST /api/admin/operations/jobs/:jobId/cancel`
- `GET /api/admin/architecture/domains`

These routes remain behind Cluster's existing admin authorization boundary. Unsafe admin operations remain behind the existing admin, CSRF/origin, and mutation-safety boundaries; retry and cancellation actions also emit explicit security-audit events.

## Event and metrics foundation

`DomainEventBus` now records bounded process-local metrics for published events, handler invocations, handler failures, listeners, last activity, and per-event-type activity. Strict `publish()` semantics are unchanged: handler failures still reject with an `AggregateError`. `publishBestEffort()` is an explicit separate API for future projections that are allowed to observe failure without failing their caller.

Operational health and diagnostics now expose durable-job worker/count snapshots and domain-event metrics alongside the existing process-local background-task metrics.

## Database boundary

The job domain owns its PostgreSQL queries behind `BackgroundJobQueue`. Claiming, lease renewal, state transitions, retry scheduling, cancellation, and attempt evidence do not leak into route handlers or the server entrypoint.

Startup schema verification now requires both job tables and their concurrency/lookup indexes. An installation that missed the Step 3 migration therefore fails visibly during schema verification instead of accepting jobs into a nonexistent queue.

## Architecture budgets

`tools/scripts/server-architecture-audit.mjs` is release-blocking. It enforces:

- a bounded server composition entrypoint;
- bounded server TypeScript compilation units;
- a compatibility-only legacy `routes/` layer;
- explicit domain ownership for Library, Time, Planning, Sync, Users, Legal, and Admin route implementations;
- presence of the durable job schema/migration/runtime/admin boundaries;
- PostgreSQL lease-safe claiming and dedupe locking;
- API/OpenAPI capability coverage;
- a cycle-free relative-import graph across server TypeScript sources.

These are regression ceilings, not design goals. A file being one byte under the budget does not make it elegant.

## Follow-on boundary

The next condensed roadmap step is **Desktop & Sync Overhaul**: native desktop capabilities, automated web/desktop parity, Offline Sync v2, and Realtime Collaboration v2.

## Administrator job monitoring

Admin Operations includes a background-jobs monitor backed by the durable queue API. It reports queue counts, worker concurrency, recent job progress, attempts, failures, dead-letter state, cancellation, and explicit administrative retry. The interface does not expose a generic enqueue control; job types remain server-registered capabilities.

The renderer implementation lives in `packages/renderer/src/features/admin/BackgroundJobsPanel.tsx`.
