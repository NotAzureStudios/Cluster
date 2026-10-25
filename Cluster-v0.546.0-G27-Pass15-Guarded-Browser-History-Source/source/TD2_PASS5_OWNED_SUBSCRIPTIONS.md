# Cluster 0.546.0 — TD2 Pass 5: Owned subscriptions and Library cache lifecycle

**Baseline:** `Cluster-v0.546.0-TD2-Pass4-Library-Durable-Ownership-Source.zip`.
**Scope:** continue unfinished TD2 runtime lifecycle, no new tools, migrations or native changes.

## What is implemented

1. `BackgroundTaskRegistry.registerOwnedSubscription(name, owner, subscribe, hooks)` now manages synchronous, disposable event listeners alongside tool-owned timers. A disabled owner disconnects its listener; a re-enabled owner reconnects once. Registration while disabled waits until enable. `stopAll` and explicit disposers remove handlers, and generation identity prevents a prior disposer removing a later registration.
2. A thrown start/dispose is handled with diagnostics. A failed subscription resume is retried by the next normal Settings availability reconciliation without waking healthy subscriptions or timers. Owned subscriptions have separately queryable `name`, `owner`, `active`, `suspended`, and `lastError` diagnostics.
3. The cross-server `library.context.invalidate` subscriber is now Library-owned. The Library cache is cleared on both disable and re-enable. This matters because updates missed during suspension could otherwise leave a stale per-user folder/resource projection when the tool returns.
4. Admin health/diagnostic responses expose `ownedSubscriptions` alongside `backgroundTasks`. Existing task-snapshot contracts are unchanged. Library's request and permission guards remain authoritative, independently of listener availability.
5. Retention/backup/storage maintenance remains unowned; other tools continue working while Library's cache listener is suspended. No attempt was made to forcibly abort running Library transfers.

## Boundaries and known limits

- This closes one **real Library event listener** lifecycle gap. Other tool-owned subscriptions, live streams, external provider workers and client-side consumers still need a complete ownership inventory and migration.
- Settings propagation between processes remains an eventually reconciled model. A disabled worker process may observe an update after its next DB reconciliation; security and request authorization must not depend solely on in-memory status.
- Callbacks already delivered before unsubscription cannot be rolled back. Cache invalidation is safe to complete.
- Automated staging retention while a tool remains disabled for long periods still needs an explicit live retention and restart test. No changes to the retention protocol are claimed in this pass.
- The checkpoint is **source-tested only**. No full dependency-backed Node 24 build, live PostgreSQL, browser, Windows or native-Qt certification was performed.

## Next TD1/TD2 work

1. Audit and enroll any other *truly tool-owned* listeners, avoiding shared infrastructure, security and audit hooks.
2. Prove extended Library-disable/resume and upload-staging retention paths with live PostgreSQL and filesystem fixtures.
3. Finish TD1 typed Settings definition ownership, scoped inheritance and provenance rather than continuing ad-hoc field metadata.
4. Certify cross-node disable races, resource usage, PostgreSQL leases and Windows shutdown.

**Regression command:** `npm run techdebt:td2:subscriptions` plus the inherited TD0/TD1/TD2 checks.
