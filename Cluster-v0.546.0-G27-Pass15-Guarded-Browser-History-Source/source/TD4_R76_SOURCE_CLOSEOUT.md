# TD4 R76 | bounded source-implementation closeout decision

**Decision:** TD4 **SOURCE-CLOSED for the enabled Cluster 0.546.0 canonical extension/resource/event contract**, as of R76. **NOT production-certified.** Storage mutation capabilities explicitly held off in R67/R68 are not enabled by this decision, and feature workflows without real destinations are not claimed implemented.

## Final defect repaired during closeout

`DurableDomainEventRuntime.drain()` previously stopped waiting after 10 seconds but returned **success** with `processing === true`. The production shutdown then disposed `integrations.webhooks` before the existing delivery completed. A consumer still executing after a silent drain timeout could complete its outbox checkpoint without guaranteed webhook fanout.

R76 makes timeout a **rejected drain barrier** with a bounded, configurable test deadline. The registered consumers cannot be unregistered while a delivery is still active. Production shutdown does not swallow this failure, so managed shutdown fails rather than declaring a safe drain and deregistering a potentially required consumer. This does not guarantee completion of an already-running remote HTTP request or prevent watchdog termination. The outbox lease, idempotency and later retry rules remain the recovery mechanism.

## Typed-event consumer decision

`work.assignment.changed` is **signal-only**, not a second materialized assignment database. The canonical source of an assignment remains the domain's own DB record. Three already-required wildcard consumers handle resource-change waking, Project read-model invalidation, and authorized webhook fanout; Activity-specific materializers deliberately do not consume the assignment event. Introducing a dedicated assignment projection in the future requires explicit backfill/replay cutoff, scoped ACLs and idempotent consumption. No dummy subscriber was registered against already-processed history.

The seven production event subscribers remain: `resource-change-runtime-wake` (`*`), `projects.read-model-invalidation` (`*`), `integrations.webhooks` (`*`), `notifications.materialize-activity` (`activity.recorded`), `automation.studio-activity` (`activity.recorded`), `projects.automation-activity` (`activity.recorded`), and `search.activity-changes` (`activity.recorded`). Startup checks owner **and** event family. The registry is frozen during delivery.

## Bounded source closure evidence

- TD0–TD3 source-closed contracts retained.
- TD4 canonical resource kinds, deep links, Search live admission, Activity/outbox typed subscriptions, resource actions and production wiring have explicit owners (see R76 owner matrix).
- R61/R62 Library hierarchy move/archive/trash/restore and R63–R68 governed disposition, ownership evidence and safety fences preserved.
- R71–R74 Source Review, Commit, Studio Forms/submissions, and Approval Search exact-target adapters preserved.
- R75 Discord/Git queued work revocation checks preserved.
- **58/58** executable TD4 script files passed (including one historical Library test-fixture repair), **11/11** focused R76 lifecycle/signal checks, source parse/CSS/import scan passed (details in R76 integrity report).

## Transfer, not silent completion

**TD5 / storage provider engineering + certification** owns generation-fenced quarantine execution, provider/backup retention proof, reversible restore, delayed physical destruction, safe managed GC and tier migration, live NAS/S3 tests, real multi-process PostgreSQL, Node 24 dependency-backed build and native Qt/Windows acceptance. Destructive storage features **remain disabled**. A quarantine simulation is not an actual quarantine.

**TD5 / remote integration acceptance** owns Git/Discord in-flight remote-call cancellation/generation fences, restart/interruption, cross-process delivery and provider token-rotation acceptance. No already-transmitted request can be recalled by an admission check.

**TD6 / application destinations** owns Announcements, public applications, automations and other unimplemented target UIs, including secondary-repository navigation. They are intentionally excluded from Search rather than opening a guessed/wrong destination. Later genuinely required resource adapters must follow the canonical registry and live authorization protocol.

**Release Certification roadmap** remains separately open for real PostgreSQL migration/concurrency, authenticated multi-user revocation, Node 24 + Prisma/client generation, Windows/Qt protocol activation and NAS/S3 recovery. Source validation does **not** establish these.

## Reopen criterion

Only reopen TD4 for a reproducible violation in the currently enabled TD4 source contracts. Future tool features belong to their domain/TD6; provider-safe destructive operations belong to TD5. Do not create another generic adapter, event runtime or scheduler simply to avoid closing a bounded phase.
