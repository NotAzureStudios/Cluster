# TD4 R51 | Typed resource-change delivery and cursor recovery audit

## Baseline and source owners

Based on exact R50 package. The canonical writers/consumers remain:

- `apps/server/src/core/domain-events.ts`: the only active `DomainEventOutbox` INSERT; transactional domain-event producer.
- `apps/server/src/core/resource-change-runtime.ts`: durable outbox projection and sequence delivery to the single process-local runtime.
- `apps/server/src/domains/changes/resource-change-routes.ts`: permission-filtered HTTP read and SSE stream, TD2 availability, per-session identity and provider authorization.
- `packages/shared/src/resource-change.ts`: shared versioned, resource-address-validated invalidation envelope.
- `packages/renderer/src/features/application/use-resource-change-invalidation.ts`: authenticated SSE cursor, invalidation and reset consumers.

## Confirmed failure paths and implementation

**Restored server with lower sequence.** An R50 client that had persisted `after=999` would reconnect to a restored database with `latest=20`, and both the HTTP pull and SSE stream would wait for sequence >999 indefinitely. HTTP now returns an explicit `resetRequired`, `resetReason: cursor_ahead`, and authoritative lower cursor; SSE emits a `cursor_ahead` reset and starts from the actual latest. Expired historical cursors retain the separate `cursor_expired` reset behavior. Both cases force canonical refetch instead of attempting to reconstruct unavailable events.

**Out-of-commit-order sequence.** PostgreSQL BIGSERIAL/identity sequences allocate numbers before transaction commit. Without writer serialization, event B with sequence 11 can commit and advance the feed before event A with sequence 10 becomes visible, causing A to be permanently missed. All writes through the canonical `appendInTransaction` path now acquire one PostgreSQL transaction-scoped advisory lock *before* inserting an outbox row; the lock is held until the outer transaction commits/rolls back. Serialized outbox inserts prevent a later committed row from passing an earlier uncommitted writer. Rollbacks may leave safe numerical gaps. This trades some concurrent outbox-write throughput for correctness. No schema change required. All active outbox inserts were inventory-checked; the only active writer is `domain-events.ts`.

**Untyped, unvalidated invalidations.** R50 projected outbox rows using unchecked resource-kind casts and renderer `JSON.parse ... as ClusterResourceChange`. R51 adds a separately versioned wire envelope (`wireVersion: 1`) and the source durable event's schema version (`eventSchemaVersion`), validates the shared canonical resource address and envelope in the server projector, and parses the same schema on the client. Unsupported/malformed SSE change frames trigger cache invalidation and mounted-workspace reset, with no cursor advancement for unverified changes. Domain-event producers reject malformed schema versions and known event-descriptor version mismatches before INSERT. Payload bytes remain server-side; wire events are invalidation-only.

## Executable evidence

- `tools/scripts/cluster-td4-r51-typed-change-feed-tests.mjs`: 13 assertions run through the actual HTTP route, SSE stream, canonical projector, durable outbox producer, and mounted React SSE hook using controlled mock dependencies. Covers future and empty history, reset to lower cursor, live delivery after reset, invalid wire and valid wire, pre-INSERT lock ordering, malformed resource identity and event schema.
- `TD4_R51_REGRESSION_RESULTS.json`: 67/67 selected inherited/new development scripts passed with Node 22.16.0 and global TypeScript fallback.
- `TD4_R51_SOURCE_SCAN.json`: all active TS/TSX, CSS and relative imports checked, with no authored parse or resolution issues. The generated Prisma client is intentionally missing from the lean checkpoint.
- Source manifest, ZIP integrity, and parent patch reconstruction are independently verified in delivery.

## Boundaries not certified or completed

- **PostgreSQL concurrency** must be tested with two genuine transactions and a fail/retry/rollback matrix. Mock SQL-call-order tests cannot prove database lock behavior on Cluster's packaged PostgreSQL runtime.
- Invalid historical outbox records now fail closed; automatic quarantine/repair for corrupt legacy outbox rows is not implemented. This is an operational recovery issue, not permission to skip arbitrary records silently.
- The versioned change envelope preserves generic event names but does not yet add full typed producer categories across all CD-01–CD-20 workflows. It is an authoritative typed transport step, not full TD4 source closeout.
- Remaining TD4: governed storage disposal and durable large hierarchy operations; remaining sensitive resource providers; canonical Search/Action adapters; producer/subscriber lifecycle inventory and resource-event semantics.
- Full dependency-backed Node 24 builds, Prisma generation/migrations, PostgreSQL, cross-process SSE behavior, and Windows/Qt certification remain on `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.
