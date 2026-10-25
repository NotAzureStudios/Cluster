# TD4 R53 | Event-history continuity implementation audit

## Source trace

- Writer: `apps/server/src/core/domain-events.ts` owns outbox UUID/event identity and serializes transactional insert commits (R51).
- Reader + poller: `apps/server/src/core/resource-change-runtime.ts` now anchors its progress to both the durable sequence and immutable row ID. Routine growth keeps the anchor; rewinds, ID replacement and pruned anchors notify live subscriptions with reset. Failed DB reads do not advance the audit interval.
- HTTP/SSE: `apps/server/src/domains/changes/resource-change-routes.ts` verifies optional `afterIdentity` against the actual row before replaying. An absent identity uses the existing cursor semantics for compatibility. Reset/ready/ping and change frames carry an opaque continuity identity where available.
- Shared contract: `packages/shared/src/resource-change.ts` extends the current v1 envelope with optional `cursorIdentity` and the polling query with optional `afterIdentity`; the wire version stays 1 because older clients can ignore these additive fields.
- Renderer: `packages/renderer/src/features/application/use-resource-change-invalidation.ts` remembers the proof with the cursor, sends both on reconnect and issues existing full invalidation on reset. A missing proof clears any previous proof rather than pairing it with a new sequence.

## Verified negative paths (mocked executable source tests)

- Restore to a shorter history and to zero resets the server poller (R52 inherited).
- Restore + rapid outbox regrowth above its old high-water is now detected by changed committed row ID (R53).
- Legitimate new events with the original checkpoint row retained do not produce false resets.
- Pruning the old anchor produces a conservative reset, not an assumption of continuity.
- Failure reading the current DB anchor does not silently mark the audit complete.
- HTTP and SSE reject mismatched or forged `afterIdentity` proofs even when the requested sequence is less than the restored latest.
- Valid proofs permit incremental delivery; sequence-only requests remain compatible.
- Renderer sends proof after reconnect, replaces it on server reset, and drops it when the server supplies no proof.
- Inherited provider ACLs, change-feed lifecycle, native/UI preservation and 68 existing selected suites passed (split execution).

## Not claimed

- Not a new database/server incarnation table or a signed authorization token. A proof is **not a grant** and never replaces the existing domain ACL checks.
- Not complete retroactive restore detection for older numeric-only cursors.
- No live Node 24/PostgreSQL concurrency, actual database restore or multi-process SSE acceptance here.
- TD4 and the outstanding physical storage/hierarchy backlog remain open.
