# TD4 R56 | Durable domain-event lease ownership audit

## Confirmed failure

`apps/server/src/core/domain-events.ts` previously claimed an outbox event under a time-limited database lease and ran its subscribers without renewing that lease. Large webhook fanout and slow external integration calls can outlive the original lease. A different API process could reclaim the row while the first worker remained active. Even after its conditional SQL update affected zero rows, the original worker added a consumer to its local completion set, incremented success counters, or attempted retry/dead-letter bookkeeping. This made concurrent duplicate effects and misleading completion reports possible.

## Implemented

1. Claim lease duration is centralized (5 seconds to 10 minutes, 60-second default) and the worker renews its lease before delivery and periodically while handlers execute (interval one-third of the lease).
2. Renewal requires matching event ID, worker ID, unexpired lease, and an unfinished/non-dead-lettered event. A zero-row renewal is treated as ownership lost.
3. Consumer checkpoint mutations use an immutable proposed completion set and commit to the in-memory set only after exactly one database row is updated under the live lease.
4. Success and failure/dead-letter updates require the same owner and unexpired lease and check their affected-row count *before* reporting counters or final status.
5. When a claimed event is stolen, its former worker stops invoking further consumers and does not overwrite the new worker's outcome; a genuine consumer error while the lease is held still enters normal retries.
6. Uses the existing canonical outbox, handler registration, event ordering, and TD2 lifecycle. No new worker, table, migration, or native executable.

## Executable evidence

- `tools/scripts/cluster-td4-r56-outbox-lease-fencing-tests.mjs`: 10/10 tests using the transpiled production runtime: lease predicates, lost ownership fencing for all writes, heartbeat extension for a slow consumer, lost-lease detection, ordered consumer delivery, actual pump ownership loss, and normal retry.
- `TD4_R56_REGRESSION_RESULTS.json`: 23/23 selected R55 inherited suites passed across bounded test batches. The legacy collection-bulk harness required temporarily linking the installed TypeScript toolchain; it was removed afterward.
- `TD4_R56_SOURCE_SCAN.json`: 1,030 TS/TSX, 4,468 relative imports, 110 CSS; zero parse/CSS/authored import errors. The generated Prisma client remains absent from the lean archive.

## Explicit limits

- This reduces duplicate processing due to **lease expiration**, but cannot provide exactly-once delivery for external side effects. A worker may crash or become unresponsive *after* an external effect but *before* its durable acknowledgement. Subscriber idempotency and replay deduplication remain required.
- SQL affected-row behavior and lease competition are tested using instrumented in-memory database adapters, not two live PostgreSQL connections. A Node 24/PostgreSQL concurrency integration test remains a release-certification gate.
- Noncooperative or CPU-blocking handlers can prevent timely renewal; guarded completion still refuses an expired claim when database access resumes. This does not retroactively cancel a side effect that already happened.
- TD4 remains open for additional typed producers/consumers, shared Search/Action adapters, remaining provider lifecycles, and Library hierarchy/disposal contracts.
