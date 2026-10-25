# Cluster v0.506 | Access and Search Consistency

**Status:** Source-tested cumulative staging checkpoint; **not** a certified Windows release and **not** merged into the authoritative Pass 15 source.

## Connected implementation

1. **Central authorization now fails closed on Access Rule storage failures.** Project/target decisions, target-card listing, realtime activity filtering, and card fetch authorization no longer translate a failed Prisma Access Rule read into `[]`. A real empty rule set remains valid; malformed query responses are rejected. This prevents inherited member permissions from overriding unavailable explicit deny rules.
2. **Search full-index rebuilds reject stale generations.** Any invalidation during `loadCorpus()` invalidates that candidate, including an initial cold build or an incremental event. Up to four fresh attempts are permitted. If changes remain continuous, the request fails closed and can retry after mutations settle; no known-stale index is published.
3. **Search Access Rule event identities converge.** Access Rule, access-rule, access_rule, access policy, access and ACL events now all trigger a complete access-rule refresh. Previously, the search normalizer converted underscores/hyphens into spaces but the event matcher did not recognize the result, so some ACL changes could be processed like ordinary Project changes.

## Verification

- `npm run cluster:0506:access:stability` exercises 13 failure-injection/consistency checks, including storage-outage boundaries, explicit deny precedence, mid-build invalidation, mutation storms, recovery and ACL event spellings.
- `npm run verify:source-foundation` must pass alongside inherited 0.506 tests.
- Package-level SHA-256 source manifest, incremental patch replay and ZIP integrity are checked before packaging.
- TS syntax, renderer imports, and CSS structural checks are source-level, **not** native/real-PostgreSQL tests.

## Known limits and next gates

- The source lineage remains reconstructed Pass 13 + staged P16C + cumulative v0.506 changes. Pass 14/15 cannot be overwritten by this tree. Replay/conflict-review this delta on the trusted Pass 15 package.
- Live multi-node authorization/revocation delivery, PostgreSQL connection-loss behavior, search corpus latency and rebuild pressure, and the Windows/client runtime matrix are not certified.
- 0.506 must still be integrated and runtime-validated. The larger 0.507 Company/Resource Graph, permissions and shared interaction/search systems, then 0.508–0.512 and 1.0, remain on the roadmap.
- Every major version retains **Major Systems + Small Wins + Cleanup + Certification** with ledger states `Planned → Backend Ready → UI Ready → Integrated → Tested → Certified`.
