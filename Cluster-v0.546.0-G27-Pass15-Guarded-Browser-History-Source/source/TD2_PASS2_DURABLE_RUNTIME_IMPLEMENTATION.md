# Cluster v0.546.0 — TD2 Pass 2: durable tool-owned execution

**Base:** `Cluster-v0.546.0-TD1-Pass2-TD2-Foundation-Source.zip`. **Result:** continued source-only checkpoint, same product version. No database migration, no native EXE rebuild.

## Implemented (code)

1. **Canonical six-switch propagation.** The existing server `TOOL_AVAILABILITY` definition is exported and used through `reconcileConfigurableToolOwners()`. At boot and after committed Settings writes, all six Studio availability switches (`timeline`, `tickets`, `calendar`, `scheduler`, `library`, `packets`) update local optional-owner state. Unknown/unconfigured tools are not accidentally disabled. The protected Settings publication callback also reconciles all six flags rather than Calendar only. Availability remains separate from user authorization.
2. **Idempotent owner state.** Repeated propagation of an unchanged flag does not reset a timer during an in-flight callback. Interval task snapshots no longer claim a future wake while a tool is suspended.
3. **Durable queue exclusion.** `BackgroundJobQueue.claim()` accepts a list of excluded job types, enforced *inside the PostgreSQL candidate selection query*, before claiming a lease or incrementing attempts. `DurableJobWorker` supplies an optional dynamic blocked-type callback. Current owned type: `automation.calendar-scan` when Calendar is off. Disabled jobs remain `QUEUED`, not silently reported `SUCCEEDED`.
4. **Claim-versus-disable race.** A worker rechecks availability just after claiming. `deferDisabled()` uses lease-fenced transactional SQL to restore a claimed job to `QUEUED` with a later due time, refund its attempt, and delete the never-executed attempt record. If cancellation was requested, the job becomes `CANCELLED` instead. The Calendar handler itself can throw `BackgroundJobDeferredError` when the tool changes state in the window before handler execution. A failure to defer is logged; the durable lease expires for recovery instead of an unhandled promise rejection falsely reporting completion.
5. **Re-enable and remote database writes.** Local Settings changes take effect immediately in this process; re-enable wakes the durable worker. A once-per-minute bounded database refresh reconciles changes made by another Cluster server process. This is **eventual** convergence, not a synchronous distributed safety guarantee.
6. **Diagnostics.** Durable worker snapshots expose a `deferred` counter in addition to the existing owned background task snapshots.

## Safety and remaining boundaries

- Only the Calendar periodic scan has been tagged with a configurable tool owner in the durable worker. This framework makes other mappings possible, but does not falsely claim that disabling Library, Packets, Tickets, Timeline or Scheduler now stops all their optional code. Their timers, subscriptions, workers, prefetchers and durable work require separate inventory and enrollment.
- Jobs that have **already entered a handler** remain in-flight; disabling does not forcibly abort them. The claim-time and handler-entry checks reduce races, but there is no hard distributed pause barrier yet.
- Durable jobs preserved during a disabled period occupy queued budget, intentionally. Admin UI should eventually expose blocked-by-tool counts and paused state.
- Cross-process refresh can take roughly one minute (plus scheduler admission/jitter) and is not sufficient for instantaneous revocation. Server-side HTTP/resource/field authorization remains authoritative, and strict distributed execution fencing is future work.
- There is no live PostgreSQL, multi-process server, real HTTP, Windows, Qt, browser, or CPU/request-count certification in this source pass. New queue tests use in-memory SQL transaction mocks and runtime worker simulations. Native binary unchanged.
- Only necessary code changed. Full typed Settings descriptors/inheritance, module subscription lifecycle, client prefetch, access explorer, and TD3+ remain open.

## Suggested next

1. Integrate complete tool-owned listener/subscription registration with the existing runtime supervisor and cancellation-aware drain mechanisms.
2. Add a typed owner map for **additional truly tool-scoped** durable jobs, rejecting ownership guesses based on name prefixes.
3. Add cross-process invalidation events and version/epoch fencing rather than relying on periodic reconciliation alone.
4. Prove worker-state transitions on PostgreSQL with two server processes, disabled-tool API matrix, and Windows startup/shutdown; measure idle activity before/after.

## Run

```sh
cd source
npm run techdebt:td2:check
npm run techdebt:td1p2:check
npm run techdebt:td1:check
npm run techdebt:td0:check
node tools/scripts/cluster-0546-tool-registry-tests.mjs
node tools/scripts/cluster-0506-config-writers-assertions.mjs
node tools/scripts/cluster-0506-settings-conflicts-assertions.mjs
```
