# TD4 R69 | Durable event subscription contracts and owner matrix

**Scope:** Source implementation / executable focused tests. The server still uses the existing PostgreSQL outbox; this pass does not add another event framework, durable consumer, migration, or provider lifecycle. R68 is the input baseline.

## Confirmed failure modes and correction

1. Before R69 `DurableDomainEventRuntime.start([...])` required only a subscriber **key**. A component could accidentally register `notifications.materialize-activity` to `work.assignment.changed` or `*` and satisfy startup admission even though its real `activity.recorded` side effect would be omitted and the outbox would still be marked processed. The R69 startup obligation is now `{key, type}`. Exact event subscribers must match the exact type, and wildcard subscribers must match `*`. Duplicate keys, invalid names, and missing/misregistered obligations fail **before** worker startup and event claims. The registry remains immutable while active.
2. `appendInTransaction` formerly used `event.projectId` as fallback `resourceProjectId` for non-assignment events, even when `event.resource` described a globally owned Packet or Person. The source canonical resource address is now authoritative. Context `projectId` stays in its separate outbox column; resource ownership is not inferred from activity context.

## Composition-owned event subscribers (finite current-source inventory)

| Consumer | Registered type | Owner | Lifecycle / handling | Notes |
| --- | --- | --- | --- | --- |
| `resource-change-runtime-wake` | `*` | Server composition | Registered before startup, present through drain | Wake resource-change feed, not a new assignment-specific view |
| `projects.read-model-invalidation` | `*` | Read-model composition | Present throughout delivery | Invalidate Project caches + publish cross-process invalidation |
| `integrations.webhooks` | `*` | Integration webhook runtime | Register before outbox start, remove after drain | Fanout to existing durable delivery queue; R60 endpoint authorization remains required |
| `notifications.materialize-activity` | `activity.recorded` | Notification service | Pre-start / retry | Idempotent recipient fanout and permissions; NOT subscribed to assignment event separately |
| `automation.studio-activity` | `activity.recorded` | Studio automation bridge | Pre-start / retry | Tool admission decided in handlers; disabled-feature action is skipped, not backfilled |
| `projects.automation-activity` | `activity.recorded` | Project automation service | Pre-start / retry | Existing business-rule and retry policies remain in force |
| `search.activity-changes` | `activity.recorded` | Search service | Pre-start / invalidation | Invalidate cached indexing from Activity |

## Typed events, producers, and consumer coverage

| Event contract | Producer | Direct named consumers | Wildcard consumers | Backfill implications |
| --- | --- | --- | --- | --- |
| `activity.recorded` | ActivityService transaction | Notifications, Studio automation, Project automation, Search | Resource-change, read-model, webhooks | All seven are mandatory at startup |
| `work.assignment.changed` | ActivityService transaction when canonical work-assignment metadata exists | **None at R69** | Resource-change, read-model, webhooks | Do not infer a dedicated subscriber or automatic historical projection. Later dedicated consumers require an explicit replay/backfill plan for already acknowledged rows |

Known event payloads and assignment identity are validated at append and replay boundaries (inherited R59). Per-resource ordering and retry/durable checkpoint protections remain from R56–R60. **No event recipient is automatically authorized just because an event was published:** downstream API/source access remains independently enforced.

## Regression results and limitations

- 11 new executable checks exercise wrong family, wildcard masquerading, duplicate/malformed required obligations, positive startup, Activity global resource scope and production owner declarations.
- 51/51 selected TD4 regression scripts passed under the development-source Node 22 test environment, including inherited R56–R68 checks; the lean archive still lacks generated Prisma and installed runtime dependencies.
- Active source parse/import scan: see `TD4_R69_SOURCE_SCAN.json`.
- Not run: dependency-backed Node 24 compilation; live multi-process PostgreSQL with concurrent claims and tool toggling; authenticated multi-user Search/Activity permissions; desktop Windows/Qt; NAS/S3.

## Still open

1. Complete real provider lifecycle and all domain-event producer/consumer owner assignments (especially if new dedicated assignment consumers are introduced). Contract admission cannot replace explicit backfill and replay semantics.
2. Search/Action resource adapters and per-tool authorization/missing-record hydration across remaining workspaces.
3. Storage disposition / quarantine remain **simulation only**, while provider generation fencing and backup-retention are unverified. Physical deletion, blob GC, and automatic migration remain disabled.
4. TD4 closure requires negative authorization, shutdown/restart and delivery/recovery tests against PostgreSQL, not just mocked source checks.
