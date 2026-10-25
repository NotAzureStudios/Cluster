# TD4 R60 → R61 continuation handoff

## Canonical continuation state

- Use `Cluster-v0.546.0-TD4-R60-Event-Provider-Lifecycle-Hardening-Source.zip`, folder `source/`, **not** R59 or historical Pass/WIP archives.
- Source version remains `0.546.0`. TD0–TD3 source-closed, TD4 active, TD5 dependent and TD6/TD7 not complete.
- No Prisma migration, existing native executable unchanged. This is a source checkpoint, not Windows/PostgreSQL release certification.
- The historical technical debt ledger and independent release certification roadmap retain separate authority.

## R60 substantive changes

- `apps/server/src/core/domain-events.ts`: immutable consumer registry while processing/started; required consumer keys at start; identity-safe disposer and restart barrier.
- `apps/server/src/app/cluster-server.ts`: finite seven-key startup requirement; drain event worker before unregistering webhooks.
- `apps/server/src/domains/integrations/webhook-service.ts`: queued webhook delivery envelope identity, current event type/Studio/Project audience and pre-dispatch endpoint recheck; scoped explicit tests; cancel unauthorized queued deliveries and retry raced configuration updates.
- `tools/scripts/cluster-td4-r56-outbox-lease-fencing-tests.mjs`: align two fixtures with the new startup registry contract without changing lease assertions.
- Two new R60 executable test scripts; new source scan, regression results, lifecycle audit and updated roadmap.

## R61 maximum-impact next targets

1. Finish **finite provider and producer/consumer ownership** outside outbox: specific non-TD2 domains, subscription cleanup in recovery/maintenance, deferred work during disable, mid-flight writes, cross-instance availability reconciliation. Extend real regression coverage; don't invent a second runtime.
2. Complete genuine Search/Action adapters/target hydration where still missing, especially source/repository secondary target.
3. Start the **Library hierarchy and retention closeout** as a connected workflow with durable jobs, previews, permission validation, deterministic progress, and crash recovery; this is larger than another provider registration.
4. Preserve R56 lease fencing, R59 per-resource ordering, R57/R58 navigation and R60 lifecycle/security checks in regression selection.

## Known source vs runtime limitations

- Node 22 TypeScript transpile/parse tests are not dependency-backed Node 24 compilation. Generated Prisma client is absent from lean source; no live database performed here.
- In-flight outbound HTTP cannot be retroactively revoked when config changes **after** final recheck. A true in-flight cancellation contract would need transport/controller coordination and a separate runtime test.
- Existing completed outbox events do not replay when registering a brand new durable consumer. Plan explicit backfill for `work.assignment.changed` typed subscriber additions.
- Native Windows/Qt protocol activation and multi-user authorization/concurrent PostgreSQL timings remain uncertified. Do not report TD4 or version 1.0 completed.
