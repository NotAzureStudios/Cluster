# TD4 R59 | Durable domain-event subscriber ownership inventory

**Evidence type:** source audit of existing subscribers. This is not provider-lifecycle certification or a declaration that all producers/consumers are complete. The event runtime persists two typed event families (`activity.recorded`, `work.assignment.changed`); additional domain-specific records use other existing authorities.

| Consumer key | Event registration | Owner / behavior | Current lifecycle evidence | Remaining risk |
| --- | --- | --- | --- | --- |
| `resource-change-runtime-wake` | `*` | Shared resource-change feed wake | App assembly before event runtime start, drains feed on server shutdown | Dynamic tool states use separate TD2 feed gating |
| `projects.read-model-invalidation` | `*` | Project read-model cache invalidation and cross-process signal | Server read-model composition before startup | Cross-process delivery failure/retry is covered only through shared outbox |
| `integrations.webhooks` | `*` | Integration webhook publication to durable delivery queue | Explicit `startEventSubscription` on normal readiness and `stopEventSubscription` during drain | Re-enable, endpoint disable and webhook queue recovery need live verification; do not dynamically remove this consumer while unprocessed events exist |
| `notifications.materialize-activity` | `activity.recorded` | Notification Inbox fanout | Registers during notification service composition; durable retry for partial fanout | Permission revocation races and delivery idempotency must remain covered |
| `automation.studio-activity` | `activity.recorded` | Studio automation Project/Ticket/Calendar activity bridge | Registers in job/automation composition; Ticket/Calendar checks are current-owner availability gates | A disabled tool event is intentionally skipped, not replayed on re-enable; other automation work must stay live |
| `projects.automation-activity` | `activity.recorded` | Project automation evaluation | Registers during Project automation service construction, checks Ticket availability | Multi-user business-rule concurrency, per-action idempotency still require runtime verification |
| `search.activity-changes` | `activity.recorded` | Shared Search index invalidation | App registers Search routes before startup | Cache/state coherence under sudden authorization changes and failover |

`work.assignment.changed` is currently used as a durable typed published identity in the shared registry; no additional subscribe site for that exact event type was found in this snapshot. Do **not** infer future consumer delivery obligations from the event being in the outbox. Revisit once its consumer is implemented; late registration after earlier rows were processed requires explicit backfill or separate history projection.

## R60 action

Create a finite lifecycle plan per consumer and per durable producer: constructor/bind phase, normal/maintenance registration, disable semantics, drain, retry, re-enable/backfill, permission revocation and shutdown. Retain the existing outbox and TD2 runtime; never unregister a durable consumer solely to implement a toggle without handling already processed and pending events. Source tests cannot prove real multi-process subscriber timing.
