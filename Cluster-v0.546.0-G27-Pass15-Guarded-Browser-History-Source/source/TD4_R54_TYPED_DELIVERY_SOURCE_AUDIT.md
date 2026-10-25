# TD4 R54 | Typed durable event and Notification Inbox replay audit

## Authority map

- `packages/shared/src/domain-event-registry.ts`: registered event type/version/required-payload schemas.
- `apps/server/src/core/domain-events.ts`: sole outbox insertion authority, PostgreSQL transaction commit-order lock, event-ID identity collision checks, persisted payload verification, subscriber checkpoint/retry.
- `apps/server/src/domains/activity/activity-service.ts`: registered producers of `activity.recorded` and `work.assignment.changed`; both inside the Activity database transaction.
- `apps/server/src/domains/notifications/notification-service.ts`: registered Activity consumer, now rethrowing durable materialization errors and retrying unexpected ACL access failures for writes.
- `tools/scripts/cluster-td4-r54-typed-consumer-retry-tests.mjs`: executable in-memory writer/consumer and partial-recipient replay coverage.

## Failure-path evidence

- Same-ID retries for the same semantic event return the existing durable row; different actor, workspace, Project, resource/scope or revision throw.
- Registered payload validation occurs before outbox insertion and again when dispatching persisted records.
- JSON corruption or invalid registered payload cannot mark a durable event processed.
- A recipient-delivery failure after another recipient succeeds causes subscriber rejection; replay fills in only undelivered recipients.
- Unexpected ACL failures during durable notification admission reject for retry, rather than permanently suppressing an intended notification. Normal read-side ACL failures still fail closed.
- Outbox insert ordering remains protected by the transaction-scoped advisory lock.

## Deliberate boundaries and limitations

- Known payload schemas require stable identity fields, not all optional event-specific metadata. An event with a valid envelope is **not** a substitute for domain resource authorization.
- Unknown custom integration event names retain envelope validation without pretending they have a registered payload schema.
- No new cross-domain producer type was fabricated to achieve a milestone count. The real remaining TD4 typed producer/subscriber inventory stays open.
- Partial Notification Inbox fanout is retry-safe only because the existing repository deduplicates by activity/recipient. External notification delivery has its own queue and remains independently recoverable.
- In-memory executable checks and syntax scans do not establish Node 24 full compilation or actual PostgreSQL guarantees.
