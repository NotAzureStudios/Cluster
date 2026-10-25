# TD2 Pass 10 — Shutdown-safe claim admission and drain

**Parent:** `Cluster-v0.546.0-TD1-Pass11-CAS-Certification-Source.zip`

## Confirmed defect

`DurableJobWorker.runBatch()` used to await PostgreSQL `queue.claim()` before admitting a handler. `stop()`/`drain()` only checked currently active handlers. A pending claim could therefore resolve after shutdown began, launch an untracked handler and let the drain phase return before it finished. This is especially relevant during controlled Cluster server shutdown and restart.

## Source implementation

- Track pending claim batches separately from already-running handlers.
- When shutdown begins while a claim is unresolved, **do not start a handler** when that claim returns. Return the claim through existing claim-token-fenced `deferDisabled` with a 1-second retry delay, preserving its attempt budget, and leave actual cancellation behavior to the queue.
- `drain()` now waits for pending claim operations (including release transaction) **before** waiting for the final active set. Failed database claims are awaited via `allSettled` without masking the error that the original `runBatch` caller receives.
- If releasing an unstarted claim fails, the worker logs the error and leaves PostgreSQL's lease expiration/reclaim protection intact. No false completion.
- Already-running work is **not abruptly aborted** at shutdown: it can safely finish atomic storage/database operations. Existing shutdown watchdog remains responsible for extreme process hangs.

## Evidence

- New executable suite: `npm run techdebt:td2:shutdown` (6/6 cases): delayed claim after stop, wait for claim-release transaction, failed release, lease already superseded, normal active-handler drain, and rejected pending claim.
- Inherited 26 TD0–TD2/Settings, tool-registry, source audit commands plus new shutdown command: **27/27 passed** on Node 22.16.0.
- Source scan: 993 active TS/TSX files, 0 syntax diagnostics; only unresolved relative import is intentionally absent generated Prisma client.
- Prisma schema and migrations unchanged. Native executable unchanged.

## Remaining TD2 work and certification

1. **Live PostgreSQL** multi-worker shutdown-during-claim test with concurrent reclaim, lease expiration, retries and cancel semantics.
2. **Node 24** full dependency-backed compile/test and actual Windows host process-tree shutdown validation. The lean archive lacks dependencies, lockfile and generated Prisma artifacts.
3. Enroll remaining optional runtime-owned workers/subscriptions only after verifying their dependencies. Core security, storage retention, audit and shared maintenance stay active.
4. Check long-running external side effects for durable idempotency; lease fencing cannot guarantee exactly-once external delivery.
5. Measure idle CPU/requests/DB activity before and after disabling tools; no resource savings are claimed based on this pass alone.

**Status:** source-tested TD2 correctness improvement; TD2 remains open and runtime certification remains pending. TD1 source-closeout status is unchanged.
