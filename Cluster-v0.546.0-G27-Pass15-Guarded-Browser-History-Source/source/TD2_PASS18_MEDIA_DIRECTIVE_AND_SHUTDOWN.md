# TD2 Pass 18 — Media control authority and in-flight maintenance shutdown

**Parent:** TD2 Pass 17 (`Cluster-v0.546.0-TD2-Pass17-Media-Worker-Control-Source.zip`). **Scope:** existing independent media worker, no new framework or product features.

## Confirmed defect

Pass 17 introduced `MediaWorkerControl`, which enters maintenance mode when its read rejects. But `mediaWorkerDirective` in `core/media-processing.ts` silently caught Prisma lookup failures and returned `active` for missing/invalid state. Consequently a failed control read could be reported as a successful active directive, bypassing the safety mechanism. This failure was visible through source-level tracing, not a live PostgreSQL reproduction.

A second lifecycle gap remained: `clearInterval` stops *future* timer firings, not heartbeats or artifact retention cleanup already in progress. The shutdown routine could issue a final `stopped` heartbeat or disconnect Prisma while an older periodic write/cleanup was still running.

## Implemented

1. The authoritative `mediaWorkerDirective` read now resides alongside the existing worker-control implementation. It accepts only recognized `active`, `drain`, or `maintenance` rows, propagates DB errors, and rejects missing/invalid rows. The worker continues to create its own control row by heartbeat before the first read. The former fail-open implementation in `core/media-processing.ts` is removed; its only caller is the standalone worker.
2. `MediaWorkerPeriodicTasks` is a small *internal lifecycle helper* for the worker's three existing periodic operations, not another scheduler. It coalesces overlapping invocations of each kind and records in-flight operations during shutdown.
3. Shutdown stops the durable worker's claims synchronously, stops intervals, then awaits in-flight periodic I/O before sending ordered `draining` and `stopped` heartbeats and disconnecting Prisma. Already-running atomic media jobs can still drain; shared media services are not tied to Library's enable switch.
4. Added `techdebt:td2:media-worker-lifecycle` with 12 executable checks for authoritative reads, missing rows, actual fail-closed control, periodic single-flight, shutdown ordering, and integration wiring.

## Deliberate limitations

- An existing media operation can still commit after the directive changes. The directive refresh is bounded by the existing 15-second freshness window, not an atomic distributed stop barrier.
- Waiting for already-running database/retention I/O can delay graceful shutdown if that I/O hangs. The host process watchdog remains necessary; we don't terminate file operations mid-commit.
- No Node24 dependency-backed full build, live PostgreSQL competing workers, Windows host control panel, or measured CPU/network/SQL baselines were available. These remain release gates.

**Result:** Source-side defect fixed and new regression coverage added. **TD2 remains pending live certification.**
