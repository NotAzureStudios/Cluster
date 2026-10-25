# Mutation and data-integrity boundary

Cluster v0.357 hardens mutations against duplicate delivery, ambiguous network failure, and concurrent edits. The goal is not to pretend a distributed system can promise magical exactly-once execution. The goal is to make retries deterministic where Cluster can prove the result, and fail closed where it cannot.

## Durable mutation receipts

Authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests under `/api/*` can carry `X-Cluster-Idempotency-Key`. Cluster's official API client adds a fresh opaque key automatically for eligible mutations.

Before the route handler executes, Cluster attempts to insert an `ApiMutationReceipt` row with a database uniqueness constraint over the authenticated user, HTTP method, route path, and idempotency key. This is a pre-execution claim, not a receipt written after the mutation. Competing requests with the same key therefore cannot both pass the claim boundary.

The request fingerprint includes the HTTP method, canonicalized query target, and canonicalized JSON body. Reusing the same key for different request content is rejected.

Completed replayable responses are retained for seven days and can be returned without running the route again. A simultaneous duplicate returns `IDEMPOTENCY_IN_PROGRESS` and a retry hint.

## Ambiguous results fail closed

A process can die after a database commit but before Cluster safely records the response. No application-level idempotency system can infer that outcome from optimism alone.

When Cluster cannot prove the prior result, the receipt is marked `uncertain`. A retry with the same key returns `IDEMPOTENCY_RESULT_UNKNOWN` instead of silently executing the mutation again. The client must refresh the affected resource before deciding whether a new mutation is appropriate.

Processing claims older than one hour are converted to `uncertain` during startup recovery. Cluster does not automatically replay them.

## Online/offline continuity

The renderer creates the idempotency key before the online mutation attempt. If connectivity fails and the request is queued for offline delivery, the queued item receives that exact same key. A response lost after server commit can therefore be reconciled by replaying the existing durable receipt instead of producing a second write.

Native/offline replay continues to send the original key until that queued mutation is resolved.

## Optimistic concurrency

Revisioned collaborative resources use compare-and-swap writes. The update or delete statement includes the revision that was actually read. If another writer advances the row before the statement executes, Cluster returns `REVISION_CONFLICT` rather than overwriting the newer state.

Step 11 strengthens this behavior for project, Library, timeline, and whiteboard mutation paths. Bulk Library mutations also advance revisions so later writers cannot accidentally compare against a stale revision that never changed.

## Destructive writes and tombstones

Where a destructive mutation also produces a synchronization tombstone, the compare-and-swap delete and tombstone creation occur in the same database transaction. Cluster does not publish a deletion tombstone for a row that failed its revision check.

## Schema verification

`ApiMutationReceipt` and its uniqueness/state indexes are part of the required PostgreSQL storage contract. A server whose schema is missing this boundary fails storage verification rather than advertising mutation-integrity support it cannot provide.

## Exclusions

Authentication, public unauthenticated endpoints, password mutation, and security-PIN routes do not use the generic mutation-receipt layer. Those endpoints have specialized authentication/replay semantics and should not persist replayable response bodies in the generic receipt table.

Third-party API clients should supply a unique `X-Cluster-Idempotency-Key` for every logical mutation and reuse that same key only when retrying that exact mutation.

## Non-claims

This boundary does not claim global exactly-once delivery across arbitrary external side effects. Integrations that contact systems outside PostgreSQL need their own idempotency semantics. The durable receipt protects Cluster route execution and makes uncertainty explicit rather than silently guessing.
