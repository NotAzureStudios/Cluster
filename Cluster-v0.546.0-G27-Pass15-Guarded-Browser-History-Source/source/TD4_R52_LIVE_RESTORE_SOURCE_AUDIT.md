# TD4 R52: live server cursor recovery and SSE cleanup

## Baseline and ownership

Exact Cluster v0.546.0 TD4 R51 full-source archive. The durable event producer, schema-versioned envelope, PostgreSQL advisory-lock sequencing, provider authorization, TD2 tool availability, and renderer invalidation contracts are preserved. This is a **source-implementation checkpoint**, not release certification.

## Confirmed issue

R51 fixed the case where a **reconnecting** browser supplied an outbox cursor newer than the restored database. However, `ResourceChangeRuntime` initializes its own cursor only at startup. A database restore **without an API restart** could leave that process's internal cursor ahead of the durable outbox indefinitely, preventing SSE subscriptions on that process from receiving newly committed events.

## Implementation

1. `apps/server/src/core/resource-change-runtime.ts` audits the current durable outbox high-water mark at a bounded 15-second cadence during active polling. If the database has moved behind the in-memory cursor, it rewinds to the real maximum and emits a typed `cursor_ahead` reset with the new authoritative cursor to subscribers that support reset notifications. Existing change-only subscribers remain compatible.
2. The reset fanout isolates synchronous and asynchronous subscriber failures with `Promise.allSettled` and does not allow a defective consumer to prevent another from getting the reset. The runtime snapshot includes rewind count, latest rewind timestamp, and next audit delay for Operations/diagnostics.
3. `apps/server/src/domains/changes/resource-change-routes.ts` gives each SSE subscription a reset callback. It emits the lower cursor, closes the stream, and relies on the existing renderer reset/reconnect/reconciliation pathway rather than delivering queued pre-restore frames under a new timeline.
4. SSE subscriptions now also clean up on **response** `finish`/`close`, because a server-initiated response termination need not fire request-side `close`. The existing cleanup is idempotent.

## Tested behavior

`tools/scripts/cluster-td4-r52-live-cursor-reset-tests.mjs` contains nine executable source-level scenarios: initial cursor, healthy polling, in-place rewind, new events after rewind, empty restored history, failed read and retry, unsubscribe behavior, reset subscriber failure isolation, and real SSE endpoint reset/response cleanup.

The inherited TD1–TD4 battery is recorded in `TD4_R52_REGRESSION_RESULTS.json`. The active TS/TSX, CSS, and relative import scan is in `TD4_R52_SOURCE_SCAN.json`.

## Remaining limitations

- No database or server-instance generation identifier is included in the wire protocol. A restore followed by enough immediate writes to **overtake** the pre-restore cursor before the poller's bounded check cannot be identified purely by comparing sequence values. A durable database incarnation token or restore-control signal would close this remaining rare window; it is not claimed implemented.
- PostgreSQL concurrency, live failover, multiple API processes, Node 24 dependency-backed build, authenticated browsers, and Qt/Windows acceptance are separate release certification gates.
- Unparseable historical outbox rows still need a controlled quarantine/repair design; no code in this checkpoint silently drops or deletes them.
- TD4 remains open for remaining producer/subscriber domain coverage, resource Search/Action adapters, sensitive providers, independent lifecycle closeout, hierarchy-wide Library jobs, and retention-governed disposal.
