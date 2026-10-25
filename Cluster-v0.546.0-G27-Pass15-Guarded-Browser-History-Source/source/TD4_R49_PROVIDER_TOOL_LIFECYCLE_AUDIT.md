# TD4 R49 | Resource-change provider tool lifecycle audit

## Confirmed integration defect

TD2 already coordinates six configurable tool switches across API admission, background jobs, and tool-owned subscriptions. However, the shared resource-change feed was not registered as any of those tools' owners: `/api/changes` and `/api/changes/stream` continued admitting matching resource-kind invalidations while the corresponding Studio tool was disabled. The administrator bypass could additionally return the entire remaining batch without rechecking a switch that changed during session refresh.

Simply unregistering the shared SSE subscription per tool is wrong: this transport also carries Project, People and other independent resources. Its cursor advances through disabled-tool events; re-enabling a tool requires an explicit reset/reconciliation, not the assumption that old IDs will be replayed.

## Implementation boundaries

- **Owner resolution:** `resource-change-tool-lifecycle.ts` maps eight resource kinds to six canonical switches, importing definitions from `configurable-tool-availability.ts`. No second Studio settings registry was created.
- **Server HTTP:** Disabled kinds are removed before domain authorization and again immediately before returning visible results. Admin fast paths and asynchronous grant/session reads are covered. Raw sequence cursor remains authoritative.
- **Server SSE:** A snapshot of TD2 owner state is compared before each batch and on the existing 25-second heartbeat. A changed fingerprint emits `reset` with reason `tool_availability_changed`. The shared feed stays online for unrelated kinds, and already-registered subscribers still clean up on disconnect. No new background timer or database polling loop was added.
- **Renderer:** Feed resets invalidate API caches, emit an existing cohesion-channel notification for mounted hooks and browser tabs, and request offline reconciliation. The resource-refresh hook already debounces its own fetches, respects visibility/offline choices, and cleans up the new listener on unmount.
- **Preservation:** Existing per-user ACL checks, Personnel Records masking, source/Studio provider authorization, resource actions, Search admission, collaboration and background workers were not replaced.

## Negative-path checks

Executed focused tests cover tool suspension, unaffected Project events, permissioned Library events, administrator fast-path race, SSE mixed-batch delivery and lost-event cursor behavior, lifecycle reset while idle, deduplicated heartbeats, both toggle directions, listener disposal, cohesion dispatch, and mounted-consumer wiring.

## Deliberate limits

- The active process uses TD2's reconciled tool-owner state. **Cross-process setting updates converge on TD2's existing bounded authoritative polling cadence**, not instantaneously. Per-request domain authorization still applies.
- The SSE reset invalidates local projections; it cannot retract event data already delivered to a different client before a policy change. Nor can source tests establish latency or freshness in a live multi-user deployment.
- This work covers tool *availability* for the shared feed, not full provider enrollment/lifecycle management. Other providers and durable Library storage disposal remain separate TD4 tasks.
- Node 22/source checks do not certify the expected Node 24 server, PostgreSQL transactions, installed native binaries or real browser sessions.
