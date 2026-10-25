# TD2 Pass 6 — preserve paused Library transfer uploads

**Source baseline:** `Cluster-v0.546.0-TD2-Pass5-Owned-Subscriptions-Source.zip` (product `0.546.0`).

## Confirmed problem

Library-owned `library.transfer.finalize` jobs were preserved in `QUEUED` when the Library tool was disabled. Their source uploads still had the normal seven-day expiry. `createUploadSession()` invokes `pruneExpiredUploads()` before opening another upload, and the preexisting pruner did not check for waiting jobs. Consequently unrelated upload activity could destroy bytes needed by a paused Library finalize job. This is a cross-component lifecycle contract defect, not a reason to stop global storage retention.

## Code changes

- `apps/server/src/domains/uploads/upload-session-runtime.ts`: upload pruning queries **active** `library.transfer.finalize` jobs with matching indexed `dedupeKey` (`library-transfer:<uploadId>`), restricting protection to completed upload sessions and to statuses `QUEUED`/`RUNNING`.
- Expired held sessions are skipped, including direct-object uploads. A terminal job releases protection automatically; other unrelated expired sessions remain eligible for cleanup.
- Keyset pagination (expiry time + ID) moves past large protected batches and remains stable even when prior rows are deleted. Work stays bounded during upload creation (max 2,500 inspected rows, 500 deletions).
- Failure to look up active job references stops pruning **before deleting that batch**. This favors data integrity over opportunistic cleanup when the DB is unavailable.
- Prune return counts expose `protectedByJob` and `scanned` for eventual operational integration.
- No new schema, services, or tool identities were introduced.

## Validation

`npm run techdebt:td2:retention` executes nine cases on the actual TypeScript implementation using mocked Prisma storage/queue queries and local staging files: queued/running retention, terminal release, direct-object retention, ordinary expiry, fail-closed DB lookup, pagination past 100 held uploads, unrelated job isolation, and canonical dedupe/status consistency.

Inherited TD0, TD1, TD1P2, TD2 durable ownership, TD1/TD2 closeout, TD2 Library, TD2 subscription, configuration writers, Settings conflicts, and tool-registry suites remain green (108 checks including nine new ones). Static parser scan: 992 TS/TSX, zero syntax errors; relative imports: 4,221, one expected generated Prisma import absent in lean source. No Node 24, live PostgreSQL, or Windows runtime certification.

## Explicit remaining risk and follow-up

- The pruner's active-job lookup and physical deletion are **not atomic** with a concurrently accepted job. Real PostgreSQL multi-process tests must cover enqueue/expiry races before claiming strong end-to-end fencing. Advisory-lock coordination or a dedicated persisted upload-to-job reservation should follow only if that test demonstrates the race.
- Retention of a long-paused transfer can be indefinite until job cancellation/completion or explicit administrative disposition. Storage-health monitoring, capacity budgets, and administrator visibility should be added and tested before long-running production use.
- Already-running file transfers continue through critical copy/commit boundaries. We intentionally did not introduce hard cancellation or disable shared upload-storage maintenance.
- TD1 canonical setting descriptors/scope/provenance and wider TD2 listener/worker enrollment remain open.
