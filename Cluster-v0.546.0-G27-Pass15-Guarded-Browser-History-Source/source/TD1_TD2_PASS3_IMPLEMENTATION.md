# Cluster v0.546.0 — TD1/TD2 existing-debt closeout, Pass 3

**Parent:** `Cluster-v0.546.0-TD2-Pass2-Durable-Ownership-Source.zip`. **No semver, Prisma schema or native runtime changes.** Targeted source implementation only, not release certification.

## Source changes

- **TD1 Studio-owned Tool Configuration confirmation:** `clusterToolStudioChangeImpact` uses the canonical persisted setting identities to identify Tool Configuration fields that also modify Studio policy. Tool Settings now shows before→after values and requires the admin to explicitly acknowledge them before save. The server checks the acknowledgement independently and returns `TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED` (409, with affected fields) for API requests that omit it. Purely tool-owned changes and quick enable/disable remain unaffected. Existing per-field CAS remains in force and draft contents survive failed saves.
- **TD2 cancellation-aware owner callbacks:** The existing `BackgroundTaskRegistry` passes an `AbortSignal` to interval and adaptive callbacks. Disabling a tool aborts signals for its active callbacks and clears pending timers; stopping a registered task or shutting down the scheduler also signals cancellation. Diagnostics expose `cancellationRequested`. Re-enabling a tool while an adaptive callback is still running waits for that callback before scheduling the next one, avoiding a duplicate wake. Interval tasks resume correctly in the same race.
- **Calendar application:** Its periodic automation enqueue checks both the signal and owner state before scheduling a new durable Calendar scan. Existing PostgreSQL queued-job preservation and claim-race handling from TD2 Pass 2 remain intact.
- **Tests:** Added `npm run techdebt:td1td2:closeout` with seven new checks on Studio impact mapping, confirmation contracts, midflight abort, disable/reenable races, interval restart, shutdown and Calendar wiring.

## Boundaries and still-open work

- `AbortSignal` is **cooperative**, not a transaction rollback or process kill. A callback already executing a database query, processing a media file, or publishing an external event may complete that operation unless its implementation explicitly observes the signal. Only the Calendar *enqueue* path has been wired to this new callback cancellation capability.
- All six Studio enable switches have runtime owner states, but **only the previously owned Calendar scheduling and durable scan paths have complete enrollment**. Do not claim Library, Packets, Scheduler, Tickets or Timeline background shutdown just because the mechanism exists.
- Studio-wide setting changes now have a preview and acknowledgement, but fully typed Settings descriptors, inheritance resolution, effective provenance, owner override UX, and cross-process immediate propagation are **still open**.
- Node 24 + full dependency build, PostgreSQL multi-process execution, actual Windows/native UI and load/idle CPU measurement remain required for runtime certification.
- No native EXE modifications or Prisma migrations.
