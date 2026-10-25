# Cluster TD4 R60 | Durable consumer ownership and integration lifecycle audit

**Evidence scope:** inspected canonical source + targeted VM execution and inherited regression scripts. This does **not** certify a running PostgreSQL/Windows/multi-process server. Canonical checkpoint R59 → R60; no additional queue/subscriber manager has been created.

## Defect A: webhook subscriber dropped before durable worker drained

R59's shutdown path called `integrationsRuntime?.webhooks.stopEventSubscription()` before `eventRuntime.drain()`. The outbox computes subscribers from its in-memory registration set and marks a row `processedAt` after all registered handlers complete. An event claimed during that gap could therefore be acknowledged without webhook materialization, and would not be replayed after restart. This is **not** repaired by retrying a background webhook job: no delivery record exists.

**R60 contract:**

1. Normal-mode server startup registers the webhook consumer **before** the event worker can claim rows.
2. `DurableDomainEventRuntime.start(requiredConsumers)` refuses to begin if any of its seven composition-owned consumers is missing.
3. The durable consumer registry refuses subscription changes while started or processing; disable switches must check admission inside handlers, not remove the outbox consumer. This is distinct from TD2-owned ephemeral UI/feed subscriptions, which may unregister on tool disable.
4. During draining, the server stops new work and drains the event worker **before** webhook consumer unsubscribe; the job runtime then drains. Stale unsubscribe callbacks are tied to their original registration and cannot delete a later same-key registration.
5. A still-running old worker blocks restart/registration changes. Outbox lease fencing and retry remain the R56/R59 implementations.

## Defect B: webhook dispatch used a stale endpoint snapshot

The endpoint was checked at the beginning of each queued delivery, then the server performed asynchronous credential lookups, payload decryption and signing. A disable, URL update, credential rotation, network-policy change, or Project/Studio scope update during those awaits could send under stale authority. An older queued delivery could also send after the endpoint stopped subscribing to its event type, even if the snapshot itself was current.

**R60 contract:**

1. Verify the decrypted delivery envelope's event ID/type against the persisted delivery identity, in addition to its existing SHA-256 integrity check.
2. Re-evaluate **current** endpoint event subscriptions and Studio/Project audience against the queued envelope. Cancel a no-longer-authorized pending delivery; do not send.
3. Reread endpoint authorization/configuration immediately before transport. Disable/delete cancels; any changed signing credential, URL, event types, Project, Studio or network/timeout policy forces an ordinary durable retry using the newest endpoint snapshot.
4. Explicit manual webhook test deliveries are allowed despite regular event-type filters only for the matching endpoint, Studio and Project. The test authoring path now includes `workspaceId` in its durable envelope.
5. Existing endpoint enabled checks at the beginning of delivery and queue recovery, bounded fanout, idempotent (endpoint,event) delivery records, outbound SSRF restrictions, durable job recovery and event-handler retry remain unchanged.

**Timing limitation:** this preflight recheck narrows a revocation window but **cannot recall an HTTP request already dispatched** or atomically lock the endpoint across network I/O. PostgreSQL transactional recovery and real HTTP concurrency still need live acceptance. Separate governance may decide how to abort in-flight HTTP on endpoint revocation without making a fake guarantee.

## Finite durable subscriber matrix (normal mode)

| Required consumer key | Event type | Runtime owner | Disabled behavior / checkpoint impact |
| --- | --- | --- | --- |
| `resource-change-runtime-wake` | `*` | Shared feed runtime | Always registered; feed itself applies tool availability and client cursor reconciliation |
| `projects.read-model-invalidation` | `*` | Server read-model composition | Always registered; Project cache invalidation does not depend on a tool's UI presence |
| `integrations.webhooks` | `*` | Webhook service, normal-mode startup/shutdown | Always registered while event delivery runs; individual endpoint authorization rechecked; failures retry outbox |
| `notifications.materialize-activity` | `activity.recorded` | Notification service | Durable idempotent materialization; failures retry, no silent partial ack |
| `automation.studio-activity` | `activity.recorded` | Studio automation bridge | Handler retains live Ticket/Calendar admission gates; disabled-tool activity is not replayed on re-enable |
| `projects.automation-activity` | `activity.recorded` | Project automation service | Handler and queued jobs retain permission/availability gates; shared runtime continues for other domains |
| `search.activity-changes` | `activity.recorded` | Search route composition | Registers before startup; cache invalidation is not a permission grant |

`work.assignment.changed` remains a published typed event with **no exact-type subscriber** in this source; wildcards still observe it. A new materialized consumer cannot assume already-processed events will replay. Implement a genuine backfill/checkpoint strategy before adding a late consumer.

## Non-durable lifecycle owners audited

- Six TD2-configurable tool switches own optional timers/feed exposure and currently use `BackgroundTaskRegistry.setOwnerEnabled`; this is **not** a legitimate reason to remove a durable outbox subscriber.
- The existing `BackgroundTaskRegistry.registerOwnedSubscription` continues to handle tool-owned ephemeral listeners (e.g. Library). It is intentionally distinct from outbox checkpoint recipients.
- Webhook delivery jobs remain in the current shared background job worker and queue. `integrations.webhook-recovery-enqueue` remains the 5-minute adaptive recovery task, not a new scheduler.
- Discord receipts use the existing adaptive background retry; they are not a durable domain-event consumer. Operational backup, mirror, storage and integrity tasks also remain existing background-task owners.

## Regression evidence

- `cluster-td4-r60-consumer-lifecycle-tests.mjs`: 8 executable checks against the transpiled real event runtime plus canonical app startup/shutdown order.
- `cluster-td4-r60-webhook-revocation-tests.mjs`: 13 executable checks against the real webhook service: success, disable/delete, endpoint reconfiguration/rotation, subscription changes, Studio/Project changes, explicit tests and envelope identity.
- Inherited R56 fixture adjusted solely to register its test handlers before marking the worker active; all existing fencing assertions preserved.
- `TD4_R60_REGRESSION_RESULTS.json` and `TD4_R60_SOURCE_SCAN.json` are the reproducible source development evidence. These use Node 22's TypeScript transform/strip, **not** Node 24 dependency-backed compilation.

## Still open: TD4 source implementation

1. Remaining provider/producer/consumer mapping outside the seven outbox consumers, particularly non-TD2 behavior across maintenance/recovery and live restarts.
2. Search/Action adapters and remaining secondary Source repository target verification.
3. Tree-wide Library moves/archive/restore with atomic previews, chunking, edit/revocation checks and crash recovery.
4. Library retention policy/legal hold, restore grace, governed irreversible disposal and evidence.
5. Negative multi-tenant and multi-user acceptance with real PostgreSQL, multiple workers and Windows native deeplink routing. These are separate certification gates.
