# TD2 Pass 17 — Standalone media worker fail-closed control and draining

**Parent:** `Cluster-v0.546.0-TD2-Pass16-Cross-Tool-Automation-Source.zip` · **Product:** `0.546.0` · **Scope:** TD2 tool/runtime reliability, not new product functionality.

## Confirmed source issue

`apps/server/src/workers/media-worker.ts` runs as an independent process, outside the server's main tool-owned timers. It previously initialized its directive state to `active`, and on a failed directive refresh kept the last state. If authoritative media-worker control became unreachable, the last `active` directive could continue authorizing new claims. Its periodic heartbeat, directive and retention intervals also continued while shutdown waited for jobs to drain.

## Implemented

- `MediaWorkerControl` is a small testable state holder for the existing `mediaWorkerDirective` read, not a second job scheduler. It starts as `maintenance` until an authoritative read succeeds.
- A refresh failure or invalid directive immediately fails closed to `maintenance` rather than reusing a previously active value.
- Directive refreshes are single-flight. If a read hangs, a successful directive goes stale after 15 seconds and `current()` becomes `maintenance`. Recovery by a fresh successful read restores the intended directive without discarding existing durable jobs.
- On shutdown the control moves permanently to `drain`, aborts the worker's idle wait and disposes its three intervals **before** awaiting durable-worker drain. Already-committing media operations are not interrupted; the existing durable lease mechanisms still govern job ownership.
- Shutdown failures now exit nonzero instead of always reporting success.
- This is an independently supervised **shared media service**. It is not incorrectly assigned to Library's Studio-level enable switch; Review/asset media processing is distinct from optional Library work. Retention and recovery are not disabled by optional tool policies.

## Executable checks

`npm run techdebt:td2:media-worker-control` exercises ten assertions: initial fail-closed, normal mode changes, loss and recovery of directive authority, stale/hung reads, concurrent requests, invalid directives, shutdown vs read races, invalid freshness budgets, and media-worker integration/shutdown wiring. Existing TD0–TD2 suites and tool-registry checks were rerun; see `TD2_PASS17_VALIDATION.md`.

## Boundaries and remaining release gates

- No live PostgreSQL 17/18, Node 24 or Windows deployment was available for this pass. These are TypeScript transpilation and controlled-source checks, not process supervision or recovery certification.
- The latest valid directive can still be used during its bounded freshness window; this is **not** an atomic distributed kill switch or a guarantee that a claimed or already-committing job halts instantly.
- Media processing is a shared worker, not the same process as the tool-owned Calendar/Library/Ticket jobs. A supervised child-process termination, hung directive query, lease reclaim and Windows service-host restart must be exercised on the actual packaged runtime.
- CPU, network and SQL idle/busy measurements for enabled vs disabled tools remain outstanding. No claim of measured compute savings is made.

**TD2 status:** Source hardening progressed, **not fully certified**. TD1 source closeout remains pending its separate PostgreSQL/Windows gate. TD3 Appearance is still queued.
