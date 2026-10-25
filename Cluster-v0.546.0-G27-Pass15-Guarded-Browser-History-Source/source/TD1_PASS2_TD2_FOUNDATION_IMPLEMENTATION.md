# Cluster 0.546.0 — TD1 Pass 2 + TD2 owned-scheduler foundation

**Baseline:** `Cluster-v0.546.0-TD1-Pass1-Source.zip`. Product version stays **0.546.0**. No database migration or native EXE modification.

## Actual code delivered

1. **Settings ownership/provenance for the six configurable tools.** `packages/shared/src/tool-settings-contract.ts` now declares which Tool Config inputs actually persist to Studio-wide settings (Timeline milestones/reporting; Scheduler timezone/workdays; Library root, starter folder, license and template policy). The code exposes `clusterToolSettingAuthority()` for a known tool/field. The Tool Configuration UI identifies linked Studio settings and names shared values the admin is about to change. No new settings values or replacement storage authority were introduced.
2. **Owner-aware optional background scheduling.** `BackgroundTaskRegistry` now accepts optional owners on interval/adaptive tasks, and can suspend/rearm an owner's timers via `setOwnerEnabled(owner, enabled)`. Suspended tasks have no pending interval or timeout and cannot launch further runs. Other tasks continue unaffected. The diagnostic snapshot includes `owner` and `suspended`.
3. **Lifecycle/race hardening.** Timer ownership checks use the exact registered record identity, avoiding stale work from an earlier registration restarting a timer with the same name. Re-enabling an owner does not immediately execute all missed intervals or duplicate pending timers. `stopAll()` remains terminal.
4. **First real integration: Calendar automation enqueue.** Its periodic scan enqueue is now owned by `calendar`. Server bootstrap reads persisted `calendarEnabled` before starting job scheduling, and the Settings mutation path pushes committed value changes to the owner controller for both Tool and Studio Settings writers. Protected settings publication also refreshes the owner state. Already queued `automation.calendar-scan` work returns a disabled-skip result before evaluating Calendar triggers.
5. **New executable checks:** `npm run techdebt:td1p2:check` exercises real timers, pause/resume, other owners, in-flight limitations, registration generations, final shutdown, and Settings ownership contracts.

## Important boundaries (not complete TD2)

- This only migrates **the Calendar periodic enqueue timer**, not every background task, event subscriber, realtime stream, prefetched page, or durable-job type. Tool availability still requires a full ownership audit of each subsystem.
- Disabling prevents future timer starts, **not cancellation of an already executing callback**. The durable worker currently skips *Calendar scan jobs that have not begun*, but a scan already executing is not interrupted. Other Calendar-triggering event paths still require policy review.
- Cross-process/cluster-node settings change propagation is not implemented. This first slice updates the running server's local scheduler on local committed writes and initializes from persisted state at startup; externally written DB changes require a refreshed authoritative runtime policy.
- Setting ownership is now **explicit**, but the Studio-wide fields still share their original storage. This is provenance and honest impact disclosure, not true project/instance inheritance or independent tool overrides.
- Live PostgreSQL concurrent admin/UI request tests, Windows shutdown tests, production job queue tests, full dependency-backed build, permissions matrix, real resource/CPU measurements, and multi-node convergence remain unverified.

## Verification

```sh
cd source
npm run techdebt:td1p2:check
npm run techdebt:td1:check
npm run techdebt:td0:check
node tools/scripts/cluster-0546-tool-registry-tests.mjs
node tools/scripts/cluster-0506-config-writers-assertions.mjs
node tools/scripts/cluster-0506-settings-conflicts-assertions.mjs
```

**Next:** Finish TD1 typed descriptors (validation, allowed scopes, impact and provenance) and TD2 runtime ownership for all configurable tools, durable queues, event subscriptions, and client prefetch, with authoritative cross-process availability and safe drain/cancellation semantics.
