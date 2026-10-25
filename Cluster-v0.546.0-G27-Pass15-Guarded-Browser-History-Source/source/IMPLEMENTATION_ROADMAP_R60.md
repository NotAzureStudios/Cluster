# Cluster implementation roadmap | revision 60

**Baseline:** v0.546.0 TD4 R60, strictly derived from R59. `TECH_DEBT_MASTER_ROADMAP.md` is the historical ledger. `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` remains the authoritative independent certification plan.

| Phase | Source state | Next work |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Preserve canonical Studio settings, availability, and job ownership |
| TD3 | Source-closed (R30) | Preserve shared interaction and native Qt contracts |
| TD4 | **Active (R60)** | Finish domain/provider owner matrix and adapter hydration; Library hierarchy and disposal |
| TD5 | Partly built | Native and desktop dependency work |
| TD6 | Major backlog | CD-01–CD-20 and Studio/forms integration |
| TD7 | Not started | Canonical cleanup and source freeze after convergence |

## R60 delivered

1. **Durable subscriber lifecycle barrier:** seven mandatory runtime-owned consumers required at normal startup; subscription changes forbidden during delivery; same-key stale unsubscribe cannot evict replacement.
2. **Shutdown ordering:** drain event worker before unregistering webhook subscriber, preventing checkpoint acknowledgements without a fanout owner.
3. **Webhook policy reauthorization:** queued delivery identity, current event subscription and Studio/Project audience checked; disabled/moved/revoked delivery cancelled, asynchronously changed configuration safely retried before outbound dispatch.
4. **Explicit test delivery scoping:** manual webhook tests identify their Studio in the signed delivery envelope and cannot bypass cross-Studio or Project scope.
5. **Tests:** 21 new focused checks and the selected inherited suites (see R60 regression JSON); no Prisma migrations or native binary changes. See `TD4_R60_EVENT_PROVIDER_LIFECYCLE_AUDIT.md` for limitations.

## TD4 implementation still required

- Finish finite producer/consumer and non-TD2 provider ownership, with disable/enable, drain, retry, revocation and replay/backfill semantics.
- Complete mandatory Search/Action target adapters and secondary Source repository resolution/hydration.
- Durable, bounded hierarchy-wide Library operations, including concurrency conflicts and recoverable undo where supported.
- Governed Library retention, legal hold, preview/restore grace and idempotent physically destructive disposal with audit evidence.
- Source closure matrix and negative ACL tests; keep live PostgreSQL/Windows/runtime certification independent.

**Not certified:** Node 24 full build, live multi-process PostgreSQL, authenticated concurrent users, Windows/Qt protocol handling, OS shutdown and in-flight HTTP cancellation timing. Source tests are not substitutes.
