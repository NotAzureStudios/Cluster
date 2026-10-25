# TD4 R55 | Webhook consumer durable replay audit

## Observed failure

`apps/server/src/domains/integrations/webhook-service.ts` subscribes to all domain events under `integrations.webhooks`. Before R55, `publishEvent` caught individual endpoint materialization failures, logged them and returned successfully. The `DurableDomainEventRuntime` then marked the consumer complete even if one or more webhook deliveries had never been recorded. A second failure was possible after successful `integrationWebhookDelivery.create`: a queue outage left a durable pending delivery, but replay hit the `(endpointId,eventId)` uniqueness rule and skipped the already-created row without enqueuing it.

## R55 corrections

- Fanout continues for the remaining endpoints, then rejects the outbox delivery when any endpoint failed. This engages the existing consumer retry/dead-letter machinery.
- Unique-key replay loads the *same* pending/retrying row and enqueues that row's ID via the existing `webhook:<deliveryId>` job deduplication key.
- Already successful or cancelled deliveries are not rescheduled.
- Endpoint database lookup failures still reject the consumer; no false successful ack.
- Subscription start/stop stays attached to the existing integration runtime.

## Evidence and bounds

Nine executable in-memory consumer/endpoint/queue checks passed, and inherited suites were rerun. There is no claim of a real PostgreSQL transaction, actual HTTPS endpoint acknowledgement, host power-loss recovery or native Windows runtime test. The current `publishEvent` query reads subscribed endpoints afresh on replay: this checkpoint does not freeze a historical endpoint audience. Rate limits, webhook payload privacy review and other integration publication policies remain separate follow-up audits.
